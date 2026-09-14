import { createHash } from "node:crypto";
import { assertExecutionSegment, EXECUTION_JOB_PLAN_BUDGET_MS, EXECUTION_JOB_WORK_BUDGET_MS, executionSandboxName, isUnsafeInstallControlPath, SANDBOX_DIAGNOSTIC_RERUN_LIMIT, SANDBOX_SCANNER_TIMEOUT_MS, validatePlan, VercelSandboxRunner, type CommandPlan, type ExecutionRevision, type ExecutionSegment, type SandboxCredentials, type SegmentOutcome } from "@buildit/runner";
import { combineScannerRuns, parseGitleaks, parseOsv, scanBuildITRules, scannerInventory } from "@buildit/scanners";
import { verifyExecutionGrant } from "@buildit/security";
import type { ArtifactBroker } from "./artifacts.js";

type Descriptor = { revision: "base" | "head"; artifactId: string; storageKey: string; checksum: string; size: number; readGrant: string };
type Body = { organizationId: string; repositoryId: string; reviewId: string; jobKey: string; segment: ExecutionSegment; baseSha: string; headSha: string; runnerImageVersion: string; runtime: "node22" | "node24"; artifacts: Descriptor[]; install?: CommandPlan; checks: CommandPlan[] };
type Runner = Pick<VercelSandboxRunner, "runSegment">;
// The two segments that need the repository itself: `prepare` writes it into the sandbox and
// `scanners` reads it here, for the rule pass that never enters a sandbox at all. Every other
// segment resumes a sandbox that already holds the tree, so re-downloading and re-checksumming up
// to 80 MB of context for each of them would be the largest single cost of splitting the review.
const segmentsNeedingContext = new Set(["prepare", "scanners"]);
export function pinnedSandboxImage(value: string | undefined) { if (!value || !/^(?:[a-z0-9][a-z0-9.\-]*(?::\d+)?\/)?[a-z0-9][a-z0-9._\-\/]*@sha256:[0-9a-f]{64}$/.test(value)) throw new Error("sandbox_image_unavailable"); return value; }
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const descriptorsForHash = (items: Descriptor[]) => items.map(({ readGrant: _, ...item }) => item);
function json(status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) { return Response.json(body, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff", ...extraHeaders } }); }
function bearer(request: Request) { const value = request.headers.get("authorization") ?? ""; if (!value.startsWith("Bearer ") || value.length > 8_200) throw new Error("authentication_required"); return value.slice(7); }
function parse(raw: string): Body { let body: Body; try { body = JSON.parse(raw) as Body; } catch { throw new Error("invalid_execution_request"); } if (!body || ![body.organizationId, body.repositoryId, body.reviewId].every(value => typeof value === "string" && value.length) || typeof body.jobKey !== "string" || !/^[A-Za-z0-9:_.-]{1,200}$/.test(body.jobKey) || !body.segment || typeof body.segment !== "object" || !/^[0-9a-f]{40}$/.test(body.baseSha) || !/^[0-9a-f]{40}$/.test(body.headSha) || !/@sha256:[0-9a-f]{64}$/.test(body.runnerImageVersion) || !["node22", "node24"].includes(body.runtime) || !Array.isArray(body.artifacts) || !body.artifacts.length || body.artifacts.length > 64 || !Array.isArray(body.checks) || body.checks.length > 4) throw new Error("invalid_execution_request"); return body; }
function unreachable(error: unknown) {
  if (!(error instanceof Error)) return false;
  const errno = (error as { code?: unknown }).code;
  const signals = [error.message, error.name, typeof errno === "string" ? errno : ""].join(" ");
  return /fetch failed|TimeoutError|AbortError|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network|Failed to fetch/i.test(signals);
}

// The sandbox provider signals an exhausted plan as a 402 with a usage-limit message. It is worth
// naming separately from "the sandbox is down": one is fixed by upgrading a plan or waiting for a
// reset date, the other by paging someone.
export function capacityExhausted(message: string) {
  return /\b402\b/.test(message) || /usage limit exceeded|quota exceeded|plan limit/i.test(message);
}

export function safeExecutionError(error: unknown) {
  const code = error instanceof Error ? error.message : "execution_failed";
  if (code === "authentication_required") return { status: 401, code };
  if (["execution_grant_invalid", "execution_grant_scope_invalid"].includes(code)) return { status: 403, code: "execution_grant_invalid" };
  if (["execution_grant_expired", "execution_grant_replayed"].includes(code)) return { status: 410, code };
  if (code.startsWith("invalid_") || code.includes("command_not_allowed") || code.includes("untrusted_command")) return { status: 400, code: "invalid_execution_request" };
  // Only stable operational categories cross this API boundary. Raw sandbox
  // failures can include provider request context and must not enter logs either.
  if (code.includes("credential_teardown") || code.includes("sandbox_")) return { status: 503, code: "runner_safety_failed" };
  if (code.includes("gitleaks") || code.includes("osv_")) return { status: 503, code: "scanner_unavailable" };
  // An exhausted plan reached this only because the provider happened to mention "Sandbox" later in
  // a long message; a shorter one would have fallen through to the generic execution_failed. The
  // caller-facing answer is the same either way - the environment was unavailable - but it should
  // be decided, not incidental.
  if (capacityExhausted(code)) return { status: 503, code: "sandbox_unavailable" };
  if (code.includes("Sandbox") || code.includes("sandbox")) return { status: 503, code: "sandbox_unavailable" };
  if (code.includes("execution_image")) return { status: 503, code: "runner_image_unavailable" };
  if (unreachable(error)) return { status: 503, code: "sandbox_unavailable" };
  return { status: 503, code: "execution_failed" };
}

// Error messages and names are untrusted. Pattern redaction missed short credentials, S3 URLs,
// and source fragments. Emit only fixed codes while keeping actionable operational distinctions.
const knownExecutionDiagnostics = new Set([
  "artifact_integrity_failed", "artifact_revision_mismatch", "artifact_file_conflict", "base_head_context_incomplete",
  "credential_teardown_failed", "sandbox_unsafe_path", "sandbox_untrusted_install_control", "sandbox_oidc_unavailable",
  "sandbox_install_plan_required", "sandbox_checks_without_install", "sandbox_check_network_must_be_denied",
  "sandbox_execution_budget_exceeded", "sandbox_image_must_be_digest_pinned", "sandbox_image_unavailable",
  "sandbox_segment_budget_exceeded", "sandbox_check_plan_unknown", "invalid_execution_segment", "execution_job_key_invalid",
  "execution_image_mismatch", "execution_environment_invalid", "paired_execution_incomplete",
  "gitleaks_execution_failed", "osv_report_invalid",
]);
export function executionFailureDiagnostic(error: unknown) {
  if (!(error instanceof Error)) return "non_error_thrown";
  const message = error.message;
  if (knownExecutionDiagnostics.has(message)) return message;
  if (capacityExhausted(message)) return "capacity_exhausted";
  if (unreachable(error)) return "sandbox_network_unavailable";
  if (/sandbox.*image.*(?:not found|missing|unavailable)/i.test(message)) return "sandbox_image_unavailable";
  if (/sandbox.*(?:concurrency limit|no capacity)/i.test(message)) return "sandbox_capacity_unavailable";
  if (/sandbox.*(?:failed to start|creation refused|creation failed)/i.test(message)) return "sandbox_start_failed";
  if (/sandbox.*(?:terminated|died)/i.test(message)) return "sandbox_terminated";
  return safeExecutionError(error).code;
}

// This is deliberately a closed list. It is safe to emit to operations logs,
// unlike an Error message which could contain sandbox, artifact, or provider context.
export function safeExecutionErrorCategory(error: unknown) {
  const code = error instanceof Error ? error.message : "unknown";
  if (/^(?:authentication_required|execution_grant_(?:invalid|scope_invalid|expired|replayed))$/.test(code)) return "grant";
  if (/^(?:artifact_(?:integrity_failed|revision_mismatch|file_conflict)|base_head_context_incomplete)$/.test(code)) return "artifact";
  // A plan limit is not an incident, it is a bill. It reported as "unexpected" - the same category
  // as a genuine crash - so the one failure an operator can actually fix looked exactly like the
  // ones they cannot. Observed as `Status code 402 ... usage limit exceeded`, which matched none of
  // the patterns below and fell through to unexpected.
  if (capacityExhausted(code)) return "capacity";
  if (/^(?:sandbox_|credential_teardown|osv_|gitleaks_)/.test(code) || /^Sandbox\b/.test(code) || unreachable(error)) return "runner_or_scanner";
  if (/^(?:invalid_|command_not_allowed|untrusted_command)/.test(code)) return "request_policy";
  if (/^(?:scanner_|execution_environment_invalid|paired_execution_incomplete|package_manager_)/.test(code)) return "evidence";
  return "unexpected";
}

export async function handleExecution(request: Request, input: { artifactBroker: ArtifactBroker; grantSecret: Uint8Array; consume: (id: string, expiresAt: number) => Promise<boolean>; runner?: Runner; sandboxCredentials?: SandboxCredentials; now?: number }) {
  try {
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
    const token = bearer(request), raw = await request.text();
    if (Buffer.byteLength(raw) > 250_000) return json(413, { error: "request_too_large" });
    const body = parse(raw), install = body.install ? validatePlan(body.install) : undefined, checks = body.checks.map(validatePlan);
    if (install && (install.planId !== "install" || install.network !== "registry_only")) throw new Error("invalid_execution_request");
    if (!install && checks.length) throw new Error("invalid_execution_request");
    if (checks.some(plan => plan.network !== "none")) throw new Error("invalid_execution_request");
    // Two ceilings now, and both are enforced here. The job budgets bound the plan as a whole, which
    // is what a signed plan is allowed to cost across every segment; the segment assertion bounds
    // what this one invocation may schedule, which is what has to fit the function's maxDuration.
    // A plan that passes the first and fails the second is a request nobody can serve, and it is a
    // request-shape problem rather than a runner fault - which is why it answers 400 like the plan
    // budget beside it, instead of a 503 telling an operator to look at an outage that is not there.
    const planBudget = (install?.timeoutMs ?? 0) + checks.reduce((sum, plan) => sum + plan.timeoutMs, 0), diagnosticBudget = checks.filter(plan => plan.required).reduce((sum, plan) => sum + plan.timeoutMs * SANDBOX_DIAGNOSTIC_RERUN_LIMIT, 0);
    if (planBudget > EXECUTION_JOB_PLAN_BUDGET_MS || planBudget + diagnosticBudget > EXECUTION_JOB_WORK_BUDGET_MS) throw new Error("invalid_execution_request");
    const grant = await verifyExecutionGrant(token, input.grantSecret, { ...(input.now === undefined ? {} : { now: input.now }), consume: input.consume });
    // The segment and the job key join the signed scope. A grant is single-use with a 120 second
    // life and is re-issued per segment, so without this a captured grant for the cheap `prepare`
    // call would authorise the expensive `checks` one, or one review's grant would address another
    // review's sandbox - the sandbox name is derived from the job key precisely so that it cannot be
    // chosen by the caller.
    if (grant.organizationId !== body.organizationId || grant.repositoryId !== body.repositoryId || grant.reviewId !== body.reviewId || grant.baseSha !== body.baseSha || grant.headSha !== body.headSha || grant.artifactsHash !== hash(descriptorsForHash(body.artifacts)) || grant.plansHash !== hash({ runnerImageVersion: body.runnerImageVersion, runtime: body.runtime, install, checks, jobKey: body.jobKey, segment: body.segment })) throw new Error("execution_grant_scope_invalid");
    if (body.artifacts.reduce((sum, item) => sum + item.size, 0) > 80_000_000) throw new Error("invalid_execution_request");
    // After the grant, not before. A tampered plan is a 403 - the signature is what caught it - and
    // checking the segment against the plan first turned that into a 400 that says the request was
    // malformed, which is a different accusation about a different party. Past this line the segment
    // is signed, so anything wrong with it is BuildIT's own worker sending nonsense.
    let segment: ExecutionSegment;
    try { segment = assertExecutionSegment(body.segment, { ...(install ? { install } : {}), checks }, SANDBOX_SCANNER_TIMEOUT_MS); }
    catch { throw new Error("invalid_execution_request"); }
    const revisions: ExecutionRevision[] = segment.revisions ?? ["base", "head"];
    const files = { base: new Map<string, string>(), head: new Map<string, string>() };
    if (segmentsNeedingContext.has(segment.stage)) {
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
    } else if (!body.artifacts.some(item => item.revision === "base") || !body.artifacts.some(item => item.revision === "head")) throw new Error("base_head_context_incomplete");
    const runner = input.runner ?? new VercelSandboxRunner(), image = input.runner ? undefined : pinnedSandboxImage(process.env.BUILDIT_SANDBOX_IMAGE);
    if (image && image !== body.runnerImageVersion) throw new Error("execution_image_mismatch");
    const execute = async (revision: ExecutionRevision) => runner.runSegment({
      segment, revision, sandboxName: executionSandboxName(body.jobKey, revision), runtime: body.runtime,
      ...(image ? { image } : {}), ...(input.sandboxCredentials ? { credentials: input.sandboxCredentials } : {}),
      ...(segmentsNeedingContext.has(segment.stage) ? { files: [...files[revision]].filter(([path]) => !isUnsafeInstallControlPath(path)).map(([path, content]) => ({ path, content })) } : {}),
      ...(install ? { install } : {}), checks,
    });
    const outcomes = new Map<ExecutionRevision, SegmentOutcome>(await Promise.all(revisions.map(async revision => [revision, await execute(revision)] as const)));
    const bounded = (outcome: SegmentOutcome | undefined) => outcome ? {
      ...(outcome.credentialTeardownProved ? { credentialTeardownProved: true } : {}),
      ...(outcome.stopped ? { stopped: true } : {}),
      results: outcome.results, diagnostics: outcome.diagnostics,
      outputs: outcome.outputs.map(output => ({ ...output, evidenceTruncated: output.text.length > 250_000, text: output.text.slice(0, 250_000) })),
    } : { results: [], outputs: [], diagnostics: {} };
    const scanner = (revision: ExecutionRevision, commitSha: string, outcome: SegmentOutcome | undefined) => ({
      ...combineScannerRuns(commitSha, [
        scanBuildITRules([...files[revision]].map(([path, content]) => ({ path, content })), commitSha),
        parseGitleaks(outcome?.gitleaksReport ?? "[]", commitSha, scannerInventory.gitleaks),
        parseOsv(outcome?.osvReport ?? '{"results":[]}', commitSha, scannerInventory.osvScanner),
      ]),
      // Carried, not dropped. A scanner that could not read this ecosystem's manifests produced an
      // empty findings list, and without this the review would present that emptiness as a clean
      // dependency scan - which is the one thing it must not claim.
      ...(outcome?.unavailableScanners?.length ? { unavailableScanners: outcome.unavailableScanners } : {}),
    });
    return json(200, {
      segment, base: bounded(outcomes.get("base")), head: bounded(outcomes.get("head")),
      ...(segment.stage === "scanners" ? { scanners: { base: scanner("base", body.baseSha, outcomes.get("base")), head: scanner("head", body.headSha, outcomes.get("head")) } } : {}),
    });
  } catch (error) {
    const mapped = safeExecutionError(error);
    // Keep quota, image, network and safety distinctions without copying exception text or names.
    console.error("buildit_execute_failure", { category: safeExecutionErrorCategory(error), code: mapped.code,
      reason: executionFailureDiagnostic(error) });
    // The body is unchanged. The header only tells BuildIT's own telemetry which 503 this was, so a
    // spent plan raises a ticket instead of paging someone about an outage they cannot fix.
    return json(mapped.status, { error: mapped.code },
      capacityExhausted(error instanceof Error ? error.message : "") ? { "x-buildit-error-code": "capacity_exhausted" } : {});
  }
}
