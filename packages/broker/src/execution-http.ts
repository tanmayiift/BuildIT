import { createHash } from "node:crypto";
import { defaultExecutionPlans, validatePlan, VercelSandboxRunner, type CommandPlan } from "@buildit/runner";
import { combineScannerRuns, parseGitleaks, parseOsv, scanBuildITRules, scannerInventory } from "@buildit/scanners";
import { verifyExecutionGrant } from "@buildit/security";
import type { ArtifactBroker } from "./artifacts.js";

type Descriptor = { revision: "base" | "head"; artifactId: string; storageKey: string; checksum: string; size: number; readGrant: string };
type Body = { organizationId: string; repositoryId: string; reviewId: string; baseSha: string; headSha: string; runnerImageVersion: string; runtime: "node22" | "node24"; artifacts: Descriptor[]; install: CommandPlan; checks: CommandPlan[] };
type Runner = Pick<VercelSandboxRunner, "run">;
export function pinnedSandboxImage(value: string | undefined) { if (!value || !/@sha256:[0-9a-f]{64}$/.test(value)) throw new Error("sandbox_image_unavailable"); return value; }
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const descriptorsForHash = (items: Descriptor[]) => items.map(({ readGrant: _, ...item }) => item);
function json(status: number, body: Record<string, unknown>) { return Response.json(body, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } }); }
function bearer(request: Request) { const value = request.headers.get("authorization") ?? ""; if (!value.startsWith("Bearer ") || value.length > 8_200) throw new Error("authentication_required"); return value.slice(7); }
function parse(raw: string): Body { let body: Body; try { body = JSON.parse(raw) as Body; } catch { throw new Error("invalid_execution_request"); } if (!body || ![body.organizationId, body.repositoryId, body.reviewId].every(value => typeof value === "string" && value.length) || !/^[0-9a-f]{40}$/.test(body.baseSha) || !/^[0-9a-f]{40}$/.test(body.headSha) || !/@sha256:[0-9a-f]{64}$/.test(body.runnerImageVersion) || !["node22", "node24"].includes(body.runtime) || !Array.isArray(body.artifacts) || !body.artifacts.length || body.artifacts.length > 64 || !Array.isArray(body.checks) || body.checks.length > 4) throw new Error("invalid_execution_request"); return body; }
function safe(error: unknown) { const code = error instanceof Error ? error.message : "execution_failed"; if (code === "authentication_required") return { status: 401, code }; if (["execution_grant_invalid", "execution_grant_scope_invalid"].includes(code)) return { status: 403, code: "execution_grant_invalid" }; if (["execution_grant_expired", "execution_grant_replayed"].includes(code)) return { status: 410, code }; if (code.startsWith("invalid_") || code.includes("command_not_allowed") || code.includes("untrusted_command")) return { status: 400, code: "invalid_execution_request" }; return { status: 503, code: "execution_failed" }; }

export async function handleExecution(request: Request, input: { artifactBroker: ArtifactBroker; grantSecret: Uint8Array; consume: (id: string, expiresAt: number) => Promise<boolean>; runner?: Runner; now?: number }) {
  try {
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
    const token = bearer(request), raw = await request.text();
    if (Buffer.byteLength(raw) > 250_000) return json(413, { error: "request_too_large" });
    const body = parse(raw), install = validatePlan(body.install), checks = body.checks.map(validatePlan);
    if (install.planId !== "install" || install.network !== "registry_only" || checks.some(plan => plan.network !== "none")) throw new Error("invalid_execution_request");
    if (install.timeoutMs + checks.reduce((sum, plan) => sum + plan.timeoutMs, 0) > 240_000) throw new Error("invalid_execution_request");
    const grant = await verifyExecutionGrant(token, input.grantSecret, { ...(input.now === undefined ? {} : { now: input.now }), consume: input.consume });
    if (grant.organizationId !== body.organizationId || grant.repositoryId !== body.repositoryId || grant.reviewId !== body.reviewId || grant.baseSha !== body.baseSha || grant.headSha !== body.headSha || grant.artifactsHash !== hash(descriptorsForHash(body.artifacts)) || grant.plansHash !== hash({ runnerImageVersion: body.runnerImageVersion, runtime: body.runtime, install, checks })) throw new Error("execution_grant_scope_invalid");
    if (body.artifacts.reduce((sum, item) => sum + item.size, 0) > 80_000_000) throw new Error("invalid_execution_request");
    const files = { base: new Map<string, string>(), head: new Map<string, string>() };
    for (const descriptor of body.artifacts) {
      if (!/^[0-9a-f]{64}$/.test(descriptor.checksum) || descriptor.size < 1 || descriptor.size > 4_000_000) throw new Error("invalid_execution_request");
      const artifact = await input.artifactBroker.get(descriptor.readGrant);
      if (artifact.artifactId !== descriptor.artifactId || artifact.body.byteLength !== descriptor.size || artifact.checksum !== descriptor.checksum) throw new Error("artifact_integrity_failed");
      const chunk = JSON.parse(Buffer.from(artifact.body).toString("utf8")) as { revision?: string; snapshot?: { commitSha?: string; files?: Array<{ path?: string; content?: string }> } };
      const expected = descriptor.revision === "base" ? body.baseSha : body.headSha;
      if (chunk.revision !== descriptor.revision || chunk.snapshot?.commitSha !== expected || !Array.isArray(chunk.snapshot.files)) throw new Error("artifact_revision_mismatch");
      for (const file of chunk.snapshot.files) { if (typeof file.path !== "string" || typeof file.content !== "string" || files[descriptor.revision].has(file.path)) throw new Error("artifact_file_conflict"); files[descriptor.revision].set(file.path, file.content); }
    }
    if (!files.base.size || !files.head.size) throw new Error("base_head_context_incomplete");
    const runner = input.runner ?? new VercelSandboxRunner(), image = input.runner ? undefined : pinnedSandboxImage(process.env.BUILDIT_SANDBOX_IMAGE);
    if (image && image !== body.runnerImageVersion) throw new Error("execution_image_mismatch");
    const execute = async (revision: "base" | "head") => runner.run({ runtime: body.runtime, ...(image ? { image } : {}), files: [...files[revision]].map(([path, content]) => ({ path, content })), install, checks });
    const [baseResult, headResult] = await Promise.all([execute("base"), execute("head")]);
    const bounded = (result: Awaited<ReturnType<Runner["run"]>>) => ({ credentialTeardownProved: result.credentialTeardownProved, stopped: result.stopped, results: result.results, outputs: result.outputs.map(output => ({ ...output, evidenceTruncated: output.text.length > 250_000, text: output.text.slice(0, 250_000) })) });
    const scanner = (revision: "base" | "head", commitSha: string, result: Awaited<ReturnType<Runner["run"]>>) => combineScannerRuns(commitSha, [
      scanBuildITRules([...files[revision]].map(([path, content]) => ({ path, content })), commitSha),
      parseGitleaks(result.gitleaksReport, commitSha, scannerInventory.gitleaks),
      parseOsv(result.osvReport, commitSha, scannerInventory.osvScanner),
    ]);
    return json(200, { base: bounded(baseResult), head: bounded(headResult), scanners: { base: scanner("base", body.baseSha, baseResult), head: scanner("head", body.headSha, headResult) } });
  } catch (error) { const mapped = safe(error); return json(mapped.status, { error: mapped.code }); }
}
