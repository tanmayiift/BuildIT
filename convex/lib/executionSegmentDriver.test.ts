import { describe, expect, it } from "vitest";
import { defaultExecutionPlans } from "@buildit/runner";
import { driveExecutionSegments, type SegmentCheckpoint } from "./executionSegmentDriver";

const plans = defaultExecutionPlans("pnpm");
const sha = (char: string) => char.repeat(40);

function harness(options: { respond?: (body: Record<string, unknown>, call: number) => { ok: boolean; status?: number; payload?: unknown }; } = {}) {
  const requests: Array<Record<string, unknown>> = [];
  const checkpoints: Array<Parameters<SegmentCheckpoint>[0]> = [];
  let version = 7, clock = 1_000;
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    requests.push(body);
    const verdict = options.respond?.(body, requests.length) ?? { ok: true };
    if (!verdict.ok) return { ok: false, status: verdict.status ?? 500, text: async () => JSON.stringify(verdict.payload ?? {}) };
    const side = () => ({ credentialTeardownProved: true, stopped: false, results: [], outputs: [], diagnostics: {} });
    return { ok: true, status: 200, json: async () => verdict.payload ?? { segment: body.segment, base: side(), head: side() } };
  }) as unknown as typeof fetch;
  const input = {
    brokerUrl: "https://broker.test", executionSecret: Buffer.alloc(32, 3),
    describe: () => [{ revision: "head" as const, artifactId: "a1", storageKey: "k/head.json", checksum: "c", size: 1, readGrant: "g" }],
    artifactsHash: "d".repeat(64), organizationId: "org", repositoryId: "repo", reviewId: "rev",
    baseSha: sha("a"), headSha: sha("b"), runnerImageVersion: "img@sha256:" + "f".repeat(64),
    runtime: "node24" as const, install: plans.install, checks: plans.checks,
    jobKey: "autofix:rev:1:" + sha("b"), runId: "run-1",
    revisions: ["base", "head"] as const,
    stage: "prepare" as const, stateVersion: version,
    rerunTargets: () => [],
    assertActive: async () => {},
    checkpoint: (async checkpointInput => { checkpoints.push(checkpointInput); return { stateVersion: ++version }; }) as SegmentCheckpoint,
    failurePrefix: "autofix_execution",
    fetchImpl, nowImpl: () => (clock += 10),
  };
  return { input, requests, checkpoints };
}

describe("the shared segment driver", () => {
  // The regression this driver exists to make impossible. The broker's parser requires `jobKey` and
  // a `segment` object and folds both into the plansHash the execution grant is checked against;
  // reviewAutofixWorker sent a body with neither, so every round was refused with HTTP 400 before a
  // sandbox was created. One loop, one statement of the contract, both callers.
  it("puts a job key and a segment on every request the broker receives", async () => {
    const { input, requests } = harness();
    const result = await driveExecutionSegments({ ...input, revisions: [...input.revisions] });
    expect(requests.length).toBeGreaterThan(1);
    for (const body of requests) {
      expect(typeof body.jobKey).toBe("string");
      expect(String(body.jobKey)).toMatch(/^[A-Za-z0-9:_.-]{1,200}$/);
      expect(body.segment).toBeTypeOf("object");
      expect(body.segment).not.toBeNull();
    }
    expect(result.segments).toBe(requests.length);
  });

  it("threads the checkpoint version forward and advances the cursor every time", async () => {
    const { input, checkpoints } = harness();
    await driveExecutionSegments({ ...input, revisions: [...input.revisions] });
    expect(checkpoints.length).toBeGreaterThan(0);
    // Each checkpoint expects the version the previous one returned; a stalled cursor is what
    // applyExecutionCheckpoint refuses, so the driver must never emit the same one twice.
    const versions = checkpoints.map(item => item.expectedVersion);
    expect(new Set(versions).size).toBe(versions.length);
    const cursors = checkpoints.map(item => item.cursor);
    expect(new Set(cursors).size).toBe(cursors.length);
    for (const item of checkpoints) expect(item.holdLeaseUntil).toBeGreaterThan(item.now);
  });

  it("surfaces the broker's own error code, and falls back to the caller's prefix", async () => {
    const refused = harness({ respond: () => ({ ok: false, status: 400, payload: { error: "invalid_execution_request" } }) });
    await expect(driveExecutionSegments({ ...refused.input, revisions: [...refused.input.revisions] })).rejects.toThrow("invalid_execution_request");
    const opaque = harness({ respond: () => ({ ok: false, status: 502, payload: "not json" }) });
    await expect(driveExecutionSegments({ ...opaque.input, revisions: [...opaque.input.revisions] })).rejects.toThrow("autofix_execution_502");
  });

  it("refuses to continue when prepare did not prove the credentials were torn down", async () => {
    const bare = () => ({ credentialTeardownProved: false, stopped: false, results: [], outputs: [], diagnostics: {} });
    const { input } = harness({ respond: body => ({ ok: true, payload: { segment: body.segment, base: bare(), head: bare() } }) });
    await expect(driveExecutionSegments({ ...input, revisions: [...input.revisions] })).rejects.toThrow("credential_teardown_unproved");
  });
});
