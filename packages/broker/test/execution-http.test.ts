import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { issueExecutionGrant } from "@buildit/security";
import { defaultExecutionPlans } from "@buildit/runner";
import { handleExecution, pinnedSandboxImage, safeExecutionError, safeExecutionErrorCategory } from "../src/execution-http";

const secret = new Uint8Array(32).fill(3), now = 1_000, baseSha = "b".repeat(40), headSha = "a".repeat(40), plans = defaultExecutionPlans("pnpm");
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function artifactBody(revision: "base" | "head") { const commitSha = revision === "base" ? baseSha : headSha, content = revision === "base" ? "export const value = 1" : "export const value = eval(input)"; return Buffer.from(JSON.stringify({ revision, snapshot: { commitSha, files: [{ path: "src/a.ts", content }, { path: "package-lock.json", content: '{"lockfileVersion":3,"packages":{}}' }, { path: ".gitleaks.toml", content: "repo-owned scanner configuration" }, { path: ".gitleaksignore", content: "repo-owned scanner exclusions" }] } })); }
function fixture(changes: Record<string, unknown> = {}) {
  const artifacts = (["base", "head"] as const).map(revision => { const content = artifactBody(revision); return { revision, artifactId: `${revision}-artifact`, storageKey: `artifacts/org-a/repo-a/review-a/${revision}-artifact/context.json`, checksum: createHash("sha256").update(content).digest("hex"), size: content.byteLength, readGrant: `${revision}-read-grant` }; });
  const body = { organizationId: "org-a", repositoryId: "repo-a", reviewId: "review-a", baseSha, headSha, runnerImageVersion: `buildit-runner@sha256:${"f".repeat(64)}`, runtime: "node22" as const, artifacts, ...plans, ...changes };
  const descriptors = artifacts.map(({ readGrant: _, ...item }) => item), grant = issueExecutionGrant({ organizationId: "org-a", repositoryId: "repo-a", reviewId: "review-a", baseSha, headSha, artifactsHash: hash(descriptors), plansHash: hash({ runnerImageVersion: body.runnerImageVersion, runtime: body.runtime, install: body.install, checks: body.checks }) }, secret, now);
  return { body, grant };
}
function dependencies(requiredConclusion: "passed" | "failed" = "passed") {
  const artifactBroker = { get: vi.fn(async (readGrant: string) => { const revision = readGrant.startsWith("base") ? "base" as const : "head" as const, body = artifactBody(revision); return { artifactId: `${revision}-artifact`, body, checksum: createHash("sha256").update(body).digest("hex") }; }) };
  const runner = { run: vi.fn(async (_input: { files: Array<{ path: string; content: string }> }) => ({ credentialTeardownProved: true, stopped: true, gitleaksReport: "[]", osvReport: '{"results":[]}', results: [{ ...plans.checks[0]!, conclusion: requiredConclusion, exitCode: requiredConclusion === "passed" ? 0 : 1, durationMs: 2 }], outputs: [{ planId: "test" as const, text: requiredConclusion, truncated: false }] })) };
  return { artifactBroker, runner };
}

describe("native base/head execution boundary", () => {
  it("returns only a source-free operational category for runner failures", () => {
    expect(safeExecutionError(new Error("credential_teardown_failed for internal environment"))).toEqual({ status: 503, code: "runner_safety_failed" });
    expect(safeExecutionError(new Error("gitleaks_execution_failed: internal output"))).toEqual({ status: 503, code: "scanner_unavailable" });
    expect(safeExecutionErrorCategory(new Error("artifact_integrity_failed"))).toBe("artifact");
    expect(safeExecutionErrorCategory(new Error("untrusted provider context must never reach logs"))).toBe("unexpected");
  });
  it("fails closed unless the hosted scanner image uses an immutable digest", () => {
    expect(() => pinnedSandboxImage(undefined)).toThrow("sandbox_image_unavailable");
    expect(() => pinnedSandboxImage("buildit-runner:latest")).toThrow("sandbox_image_unavailable");
    expect(pinnedSandboxImage(`buildit-runner@sha256:${"a".repeat(64)}`)).toContain("@sha256:");
  });
  it("runs exact trusted plans on both revisions and returns bounded deterministic evidence", async () => {
    const f = fixture(), deps = dependencies();
    const response = await handleExecution(new Request("https://broker/api/execute", { method: "POST", headers: { authorization: `Bearer ${f.grant}` }, body: JSON.stringify(f.body) }), { artifactBroker: deps.artifactBroker as never, runner: deps.runner as never, grantSecret: secret, consume: async () => true, now });
    expect(response.status).toBe(200);
    const output = await response.json();
    expect(deps.runner.run).toHaveBeenCalledTimes(2);
    for (const [run] of deps.runner.run.mock.calls) {
      expect(run.files.map((file: { path: string }) => file.path)).toEqual(["src/a.ts", "package-lock.json"]);
    }
    expect(output).toMatchObject({ base: { credentialTeardownProved: true }, head: { credentialTeardownProved: true }, scanners: { head: { runs: [{ scanner: "builditRules", scannerVersion: "1.0.0" }, { scanner: "gitleaks", scannerVersion: "8.28.0" }, { scanner: "osvScanner", scannerVersion: "2.2.3" }], findings: [expect.objectContaining({ ruleId: "buildit-js-eval" })] } } });
  });

  it("never recreates a full sandbox to diagnose a failed required check", async () => {
    const f = fixture(), deps = dependencies("failed");
    const response = await handleExecution(new Request("https://broker/api/execute", { method: "POST", headers: { authorization: `Bearer ${f.grant}` }, body: JSON.stringify(f.body) }), { artifactBroker: deps.artifactBroker as never, runner: deps.runner as never, grantSecret: secret, consume: async () => true, now });
    expect(response.status).toBe(200);
    expect(deps.runner.run).toHaveBeenCalledTimes(2);
  });

  it("rejects tenant, plan, and artifact changes before sandbox execution", async () => {
    const original = fixture();
    for (const changed of [{ ...original.body, organizationId: "org-b" }, { ...original.body, checks: [] }, { ...original.body, headSha: "e".repeat(40) }, { ...original.body, runnerImageVersion: `buildit-runner@sha256:${"e".repeat(64)}` }]) {
      const deps = dependencies(), response = await handleExecution(new Request("https://broker/api/execute", { method: "POST", headers: { authorization: `Bearer ${original.grant}` }, body: JSON.stringify(changed) }), { artifactBroker: deps.artifactBroker as never, runner: deps.runner as never, grantSecret: secret, consume: async () => true, now });
      expect(response.status).toBe(403);
      expect(deps.runner.run).not.toHaveBeenCalled();
    }
  });

  it("rejects work that cannot finish inside the serverless budget", async () => {
    const f = fixture({ install: { ...plans.install, timeoutMs: 200_000 }, checks: [{ ...plans.checks[0]!, timeoutMs: 100_000 }] }), deps = dependencies();
    const response = await handleExecution(new Request("https://broker/api/execute", { method: "POST", headers: { authorization: `Bearer ${f.grant}` }, body: JSON.stringify(f.body) }), { artifactBroker: deps.artifactBroker as never, runner: deps.runner as never, grantSecret: secret, consume: async () => true, now });
    expect(response.status).toBe(400);
    expect(deps.runner.run).not.toHaveBeenCalled();
  });

  it("rejects replay before reading artifacts", async () => {
    const f = fixture(), deps = dependencies(), response = await handleExecution(new Request("https://broker/api/execute", { method: "POST", headers: { authorization: `Bearer ${f.grant}` }, body: JSON.stringify(f.body) }), { artifactBroker: deps.artifactBroker as never, runner: deps.runner as never, grantSecret: secret, consume: async () => false, now });
    expect(response.status).toBe(410);
    expect(deps.artifactBroker.get).not.toHaveBeenCalled();
  });
});
