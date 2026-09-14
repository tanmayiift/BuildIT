import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { issueExecutionGrant } from "@buildit/security";
import { defaultExecutionPlans, executionSandboxName, type ExecutionSegment } from "@buildit/runner";
import { handleExecution, pinnedSandboxImage, safeExecutionError, safeExecutionErrorCategory } from "../src/execution-http";

const secret = new Uint8Array(32).fill(3), now = 1_000, baseSha = "b".repeat(40), headSha = "a".repeat(40), plans = defaultExecutionPlans("pnpm");
const jobKey = "validation:review-a:0:" + headSha;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const scannersSegment: ExecutionSegment = { stage: "scanners", index: 0 };
const checksSegment: ExecutionSegment = { stage: "checks", index: 0, planId: "test", revisions: ["base", "head"] };
function artifactBody(revision: "base" | "head") { const commitSha = revision === "base" ? baseSha : headSha, content = revision === "base" ? "export const value = 1" : "export const value = eval(input)"; return Buffer.from(JSON.stringify({ revision, snapshot: { commitSha, files: [{ path: "src/a.ts", content }, { path: "package-lock.json", content: '{"lockfileVersion":3,"packages":{}}' }, { path: ".gitleaks.toml", content: "repo-owned scanner configuration" }, { path: ".gitleaksignore", content: "repo-owned scanner exclusions" }] } })); }
function fixture(changes: Record<string, unknown> = {}, segment: ExecutionSegment = scannersSegment) {
  const artifacts = (["base", "head"] as const).map(revision => { const content = artifactBody(revision); return { revision, artifactId: `${revision}-artifact`, storageKey: `artifacts/org-a/repo-a/review-a/${revision}-artifact/context.json`, checksum: createHash("sha256").update(content).digest("hex"), size: content.byteLength, readGrant: `${revision}-read-grant` }; });
  const body = { organizationId: "org-a", repositoryId: "repo-a", reviewId: "review-a", jobKey, segment, baseSha, headSha, runnerImageVersion: `buildit-runner@sha256:${"f".repeat(64)}`, runtime: "node22" as const, artifacts, ...plans, ...changes };
  const descriptors = artifacts.map(({ readGrant: _, ...item }) => item), grant = issueExecutionGrant({ organizationId: "org-a", repositoryId: "repo-a", reviewId: "review-a", baseSha, headSha, artifactsHash: hash(descriptors), plansHash: hash({ runnerImageVersion: body.runnerImageVersion, runtime: body.runtime, install: body.install, checks: body.checks, jobKey: body.jobKey, segment: body.segment }) }, secret, now);
  return { body, grant };
}
function dependencies(requiredConclusion: "passed" | "failed" = "passed") {
  const artifactBroker = { get: vi.fn(async (readGrant: string) => { const revision = readGrant.startsWith("base") ? "base" as const : "head" as const, body = artifactBody(revision); return { artifactId: `${revision}-artifact`, body, checksum: createHash("sha256").update(body).digest("hex") }; }) };
  const runner = { runSegment: vi.fn(async (input: { segment: ExecutionSegment; files?: Array<{ path: string; content: string }> }) => ({
    ...(input.segment.stage === "prepare" ? { credentialTeardownProved: true as const } : {}),
    ...(input.segment.stage === "compare" ? { stopped: true as const } : {}),
    ...(input.segment.stage === "scanners" ? { gitleaksReport: "[]", osvReport: '{"results":[]}' } : {}),
    results: input.segment.stage === "checks" ? [{ ...plans.checks[0]!, conclusion: requiredConclusion, exitCode: requiredConclusion === "passed" ? 0 : 1, durationMs: 2 }] : [],
    outputs: input.segment.stage === "checks" ? [{ planId: "test" as const, text: requiredConclusion, truncated: false }] : [],
    diagnostics: input.segment.stage === "checks" ? { test: [{ conclusion: requiredConclusion }] } : {},
  })) };
  return { artifactBroker, runner };
}
const post = (f: { body: unknown; grant: string }, deps: ReturnType<typeof dependencies>, consume: () => Promise<boolean> = async () => true) =>
  handleExecution(new Request("https://broker/api/execute", { method: "POST", headers: { authorization: `Bearer ${f.grant}` }, body: JSON.stringify(f.body) }), { artifactBroker: deps.artifactBroker as never, runner: deps.runner as never, grantSecret: secret, consume, now });

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
  it("scans both revisions on repository-owned files it refuses to let the scanners configure", async () => {
    const f = fixture(), deps = dependencies();
    const response = await post(f, deps);
    expect(response.status).toBe(200);
    const output = await response.json();
    expect(deps.runner.runSegment).toHaveBeenCalledTimes(2);
    for (const [run] of deps.runner.runSegment.mock.calls) {
      expect(run.files!.map((file: { path: string }) => file.path)).toEqual(["src/a.ts", "package-lock.json"]);
    }
    expect(output).toMatchObject({ scanners: { head: { runs: [{ scanner: "builditRules", scannerVersion: "1.0.0" }, { scanner: "gitleaks", scannerVersion: "8.28.0" }, { scanner: "osvScanner", scannerVersion: "2.2.3" }], findings: [expect.objectContaining({ ruleId: "buildit-dynamic-eval" })] } } });
  });

  it("runs exact trusted plans on both revisions and returns bounded deterministic evidence", async () => {
    const f = fixture({}, checksSegment), deps = dependencies();
    const response = await post(f, deps);
    expect(response.status).toBe(200);
    const output = await response.json() as { base: { results: Array<{ planId: string }> }; head: { results: Array<{ planId: string }> } };
    expect(deps.runner.runSegment).toHaveBeenCalledTimes(2);
    expect(output.base.results.map(item => item.planId)).toEqual(["test"]);
    expect(output.head.results.map(item => item.planId)).toEqual(["test"]);
  });

  // The reason the whole review no longer fits one invocation and no longer has to: every segment
  // addresses one sandbox per revision, by a name derived from the signed job key, so the install a
  // previous segment paid for is still there. A caller cannot name the sandbox, which is what stops
  // one review's grant reaching another review's filesystem.
  it("never recreates a full sandbox to diagnose a failed required check", async () => {
    const deps = dependencies("failed");
    const names = new Set<string>();
    for (const segment of [checksSegment, { stage: "diagnostics" as const, index: 0, planId: "test" as const, revisions: ["base" as const, "head" as const] }]) {
      const response = await post(fixture({}, segment), deps);
      expect(response.status).toBe(200);
      for (const [run] of deps.runner.runSegment.mock.calls) names.add((run as unknown as { sandboxName: string }).sandboxName);
    }
    expect(deps.runner.runSegment).toHaveBeenCalledTimes(4);
    expect([...names].sort()).toEqual([executionSandboxName(jobKey, "base"), executionSandboxName(jobKey, "head")].sort());
  });

  it("rejects tenant, plan, and artifact changes before sandbox execution", async () => {
    const original = fixture();
    for (const changed of [{ ...original.body, organizationId: "org-b" }, { ...original.body, checks: [] }, { ...original.body, headSha: "e".repeat(40) }, { ...original.body, runnerImageVersion: `buildit-runner@sha256:${"e".repeat(64)}` }, { ...original.body, jobKey: "validation:review-b:0:" + headSha }, { ...original.body, segment: checksSegment }]) {
      const deps = dependencies(), response = await post({ body: changed, grant: original.grant }, deps);
      expect(response.status).toBe(403);
      expect(deps.runner.runSegment).not.toHaveBeenCalled();
    }
  });

  it("rejects work that cannot finish inside the serverless budget", async () => {
    const f = fixture({ install: { ...plans.install!, timeoutMs: 500_000 }, checks: [{ ...plans.checks[0]!, timeoutMs: 300_000 }] }), deps = dependencies();
    const response = await post(f, deps);
    expect(response.status).toBe(400);
    expect(deps.runner.runSegment).not.toHaveBeenCalled();
  });

  // The ceiling that the split exists to satisfy, and it is not the one above. A plan can sit inside
  // the job budget and still contain a single check no 300-second function can run, which is exactly
  // the state the pre-split budgets could not express.
  it("rejects a single segment the function ceiling cannot hold, even when the whole plan fits", async () => {
    const lint = { ...plans.checks[1]!, timeoutMs: 220_000 };
    const f = fixture({ checks: [lint] }, { stage: "checks", index: 0, planId: "lint", revisions: ["base", "head"] }), deps = dependencies();
    const whole = plans.install!.timeoutMs + lint.timeoutMs;
    expect(whole).toBeLessThanOrEqual(420_000);
    const response = await post(f, deps);
    expect(response.status).toBe(400);
    expect(deps.runner.runSegment).not.toHaveBeenCalled();
  });

  it("rejects replay before reading artifacts", async () => {
    const f = fixture(), deps = dependencies(), response = await post(f, deps, async () => false);
    expect(response.status).toBe(410);
    expect(deps.artifactBroker.get).not.toHaveBeenCalled();
  });

  // Seven segments per review, and only two of them need the repository itself. Re-downloading and
  // re-checksumming up to 80 MB for the other five would have made splitting the review the most
  // expensive thing about it.
  it("downloads the context only for the segments that use it", async () => {
    for (const [segment, reads] of [[scannersSegment, 2], [checksSegment, 0], [{ stage: "compare" as const, index: 0 }, 0]] as const) {
      const deps = dependencies(), response = await post(fixture({}, segment), deps);
      expect(response.status, segment.stage).toBe(200);
      expect(deps.artifactBroker.get.mock.calls.length, segment.stage).toBe(reads);
    }
  });
});
