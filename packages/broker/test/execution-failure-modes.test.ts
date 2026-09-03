import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { issueExecutionGrant } from "@buildit/security";
import { defaultExecutionPlans, VercelSandboxRunner, type SandboxLike } from "@buildit/runner";
import { handleExecution, safeExecutionError, safeExecutionErrorCategory } from "../src/execution-http";

// Production recorded four `execution_failed` and one `sandbox_unavailable`, and neither was ever
// reproduced - "it has not recurred" is not a measurement. These drive the real VercelSandboxRunner
// through the real handleExecution and assert what each realistic failure actually becomes. The
// only thing faked is the Vercel Sandbox SDK boundary itself, because that is the part BuildIT does
// not own; the runner, the classifier and the HTTP response are the production code.
//
// A genuine provider outage still cannot be caused on demand. What is pinned here is that every
// failure BuildIT can reach turns into one specific, honest, non-leaking code.

const secret = new Uint8Array(32).fill(3), now = 1_000, baseSha = "b".repeat(40), headSha = "a".repeat(40), plans = defaultExecutionPlans("pnpm");
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function artifactBody(revision: "base" | "head") {
  const commitSha = revision === "base" ? baseSha : headSha;
  const content = revision === "base" ? "export const value = 1" : "export const value = 2";
  return Buffer.from(JSON.stringify({ revision, snapshot: { commitSha, files: [
    { path: "src/a.ts", content },
    { path: "package-lock.json", content: '{"lockfileVersion":3,"packages":{}}' },
  ] } }));
}

function request() {
  const artifacts = (["base", "head"] as const).map(revision => {
    const content = artifactBody(revision);
    return { revision, artifactId: `${revision}-artifact`, storageKey: `artifacts/org-a/repo-a/review-a/${revision}-artifact/context.json`,
      checksum: createHash("sha256").update(content).digest("hex"), size: content.byteLength, readGrant: `${revision}-read-grant` };
  });
  const body = { organizationId: "org-a", repositoryId: "repo-a", reviewId: "review-a", baseSha, headSha,
    runnerImageVersion: `buildit-runner@sha256:${"f".repeat(64)}`, runtime: "node22" as const, artifacts, ...plans };
  const descriptors = artifacts.map(({ readGrant: _ignored, ...item }) => item);
  const grant = issueExecutionGrant({ organizationId: "org-a", repositoryId: "repo-a", reviewId: "review-a", baseSha, headSha,
    artifactsHash: hash(descriptors), plansHash: hash({ runnerImageVersion: body.runnerImageVersion, runtime: body.runtime, install: body.install, checks: body.checks }) }, secret, now);
  return new Request("https://broker/api/execute", { method: "POST", headers: { authorization: `Bearer ${grant}` }, body: JSON.stringify(body) });
}

const artifactBroker = () => ({
  get: vi.fn(async (readGrant: string) => {
    const revision = readGrant.startsWith("base") ? "base" as const : "head" as const, body = artifactBody(revision);
    return { artifactId: `${revision}-artifact`, body, checksum: createHash("sha256").update(body).digest("hex") };
  }),
});

// A sandbox that works, so a single injected fault is the only thing under test.
function workingSandbox(overrides: Partial<SandboxLike> = {}): SandboxLike {
  const finished = { exitCode: 0, durationMs: 1, stdout: async () => "ok", stderr: async () => "" };
  return {
    writeFiles: async () => undefined,
    readFileToBuffer: async file => Buffer.from(file.path.includes("osv") ? '{"results":[]}' : "[]"),
    runCommand: async () => finished,
    updateNetworkPolicy: async () => undefined,
    stop: async () => undefined,
    ...overrides,
  };
}

/** Runs the genuine runner and classifier, returning exactly what the review worker would see. */
async function execute(factory: () => Promise<SandboxLike>) {
  const runner = new VercelSandboxRunner(factory);
  const response = await handleExecution(request(), {
    artifactBroker: artifactBroker() as never, runner: runner as never,
    grantSecret: secret, consume: async () => true, now,
  });
  return { status: response.status, body: await response.json() as { error?: string } };
}

describe("what a real sandbox failure becomes", () => {
  // The one production sandbox_unavailable. BuildIT's own sandbox_* errors are caught earlier and
  // become runner_safety_failed, so this code can only ever mean the provider itself.
  it("names the provider failing to start", async () => {
    const result = await execute(async () => { throw new Error("Sandbox failed to start: no capacity in region cdg1"); });
    expect(result).toEqual({ status: 503, body: { error: "sandbox_unavailable" } });
  });

  it("names the provider dying mid-run", async () => {
    const result = await execute(async () => workingSandbox({
      runCommand: async () => { throw new Error("Sandbox terminated unexpectedly"); },
    }));
    expect(result).toEqual({ status: 503, body: { error: "sandbox_unavailable" } });
  });

  // Reachability. Until the classifier learned these they fell through to execution_failed, whose
  // message tells an operator to retry "when the service is available" without saying which one.
  it("names an unreachable sandbox control plane", async () => {
    const result = await execute(async () => { throw new TypeError("fetch failed"); });
    expect(result).toEqual({ status: 503, body: { error: "sandbox_unavailable" } });
  });

  it("names a sandbox that never answered", async () => {
    const result = await execute(async () => { throw new DOMException("The operation timed out", "TimeoutError"); });
    expect(result).toEqual({ status: 503, body: { error: "sandbox_unavailable" } });
  });

  it("names a dropped connection", async () => {
    const result = await execute(async () => { throw Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }); });
    expect(result).toEqual({ status: 503, body: { error: "sandbox_unavailable" } });
  });

  // execution_failed keeps its job: the genuine unknown. Both of these are unnameable by design.
  it("falls back to execution_failed for something thrown that is not an Error", async () => {
    const result = await execute(async () => { throw "boom"; });
    expect(result).toEqual({ status: 503, body: { error: "execution_failed" } });
  });

  it("falls back to execution_failed for an unrecognised runtime fault", async () => {
    const result = await execute(async () => workingSandbox({
      readFileToBuffer: async () => { throw new Error("unexpected internal state"); },
    }));
    expect(result).toEqual({ status: 503, body: { error: "execution_failed" } });
  });

  // The reason safeExecutionError exists at all, and untested for these two codes until now.
  it("never lets provider text reach the response", async () => {
    const leaky = "s3://buildit-artifacts/org-a/review-a token=sk-live-9f3 at Sandbox.create";
    const result = await execute(async () => { throw new Error(`Sandbox failed: ${leaky}`); });
    expect(result.body.error).toBe("sandbox_unavailable");
    expect(JSON.stringify(result.body)).not.toContain("sk-live");
    expect(JSON.stringify(result.body)).not.toContain("s3://");
  });
});

describe("what a real sandbox failure is logged as", () => {
  // safeExecutionErrorCategory is the field that exists to make outages measurable. Its regex is
  // anchored ^sandbox_, and the provider says "Sandbox failed to start" - capital S, no underscore
  // - so a real outage was logging as an unexpected code defect. The one thing that had to be
  // right for "measured" to mean anything was the thing that was wrong.
  it("classifies a provider outage as infrastructure, not as an unexpected defect", () => {
    for (const error of [
      new Error("Sandbox failed to start: no capacity"),
      new Error("Sandbox terminated unexpectedly"),
      new TypeError("fetch failed"),
      new DOMException("The operation timed out", "TimeoutError"),
    ]) {
      expect(safeExecutionErrorCategory(error), String(error)).toBe("runner_or_scanner");
      expect(safeExecutionError(error).code, String(error)).toBe("sandbox_unavailable");
    }
  });

  it("still classifies a genuine unknown as unexpected", () => {
    expect(safeExecutionErrorCategory(new Error("something nobody has seen"))).toBe("unexpected");
    expect(safeExecutionError(new Error("something nobody has seen")).code).toBe("execution_failed");
  });

  // The boundary that must not move: BuildIT's own safety failures stay safety failures.
  it("leaves the safety and scanner categories exactly where they were", () => {
    expect(safeExecutionError(new Error("credential_teardown_failed")).code).toBe("runner_safety_failed");
    expect(safeExecutionError(new Error("sandbox_unsafe_path")).code).toBe("runner_safety_failed");
    expect(safeExecutionError(new Error("sandbox_untrusted_install_control")).code).toBe("runner_safety_failed");
    expect(safeExecutionError(new Error("gitleaks_execution_failed")).code).toBe("scanner_unavailable");
    expect(safeExecutionError(new Error("osv_report_invalid")).code).toBe("scanner_unavailable");
  });
});
