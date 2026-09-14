import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { credentialTeardownRevisions } from "@buildit/contracts";
import { defaultExecutionPlans, type ExecutionSegment } from "@buildit/runner";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { runIdFor } from "./lib/runIdentity";

const modules = import.meta.glob("./**/*.ts");
const base = "b".repeat(40), head = "a".repeat(40);
const validate = makeFunctionReference<"action">("reviewValidationWorker:validate");
const plans = defaultExecutionPlans("pnpm");

function snapshot(revision: "base" | "head") {
  return Buffer.from(JSON.stringify({ revision, snapshot: { commitSha: revision === "base" ? base : head, files: [
    { path: "package.json", content: "{}" }, { path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" },
  ] } }));
}

async function seed(t: ReturnType<typeof convexTest>) {
  return t.run(async ctx => {
    const now = 1_000;
    const organizationId = await ctx.db.insert("organizations", { name: "Segments", slug: "segments", timezone: "UTC", region: "eu-west-1", retentionHours: 24, monthlyBudget: 50, concurrencyLimit: 2, planId: "test", fingerprintKeyVersion: 1, createdAt: now });
    const installationId = await ctx.db.insert("githubInstallations", { organizationId, installationId: 1, accountLogin: "segments", accountType: "user", permissionSnapshot: { metadata: "read", contents: "read", pullRequests: "write", issues: "read", checks: "write" }, status: "active", createdAt: now, updatedAt: now });
    const repositoryId = await ctx.db.insert("repositories", { organizationId, installationId, githubRepositoryId: 1, owner: "segments", name: "repo", defaultBranch: "main", enabled: true, autofixMode: "stacked", forkPolicy: "manual_review_only", indexState: "ready", concurrencyLimit: 1, createdAt: now, updatedAt: now });
    const configArtifactId = await ctx.db.insert("artifacts", { organizationId, repositoryId, type: "configuration", storageKey: "config", encrypted: true, checksum: "a", size: 1, redactionStatus: "redacted", expiresAt: 9e12, deletionAttempts: 0 });
    const configRevisionId = await ctx.db.insert("configRevisions", { organizationId, repositoryId, sourceCommitSha: base, sourceRef: "main", configArtifactId, contentHash: "config", rulesDigest: "rules", schemaVersion: "1", validationState: "valid", provenance: "defaults_only", refProtectionState: "unverified", createdAt: now });
    const reviewId = await ctx.db.insert("reviews", { organizationId, repositoryId, configRevisionId, githubRepositoryId: 1, prNumber: 1, isFork: false, baseRef: "main", baseSha: base, headSha: head, requiredCheckPolicy: "advisory", completedRoundCount: 0, patchAttemptCount: 0, diagnosticRunCount: 0, providerRetryCount: 0, commandRetryCount: 0, trigger: "dashboard", triggerVerb: "review", triggerActor: "test", triggerActorPermission: "admin", mode: "review", status: "validating", budgetLimit: 5, budgetConsumed: 0, nextActionCode: "none", isStale: false, trustedRef: "main", trustedRefSha: base, configProvenance: "defaults_only", provider: "anthropic", model: "test", modelVersion: "test", promptVersion: "test", evalSetVersion: "test", coverageLevel: "full", currentStage: "validation", runnerImageVersion: `buildit-runner@sha256:${"f".repeat(64)}`, executionGeneration: 0, queuePriority: 0, expiresAt: 9e12, createdAt: now, updatedAt: now });
    for (const revision of ["base", "head"] as const) {
      const body = snapshot(revision);
      const id = await ctx.db.insert("artifacts", { organizationId, repositoryId, reviewId, type: "repository_snapshot", storageKey: "pending", encrypted: true,
        checksum: createHash("sha256").update(body).digest("hex"), size: body.byteLength, redactionStatus: "redacted", expiresAt: 9e12, deletionAttempts: 0 });
      await ctx.db.patch(id, { storageKey: `artifacts/${organizationId}/${repositoryId}/${reviewId}/${id}/context-${revision}-0.json` });
    }
    return { organizationId, repositoryId, reviewId } satisfies { organizationId: Id<"organizations">; repositoryId: Id<"repositories">; reviewId: Id<"reviews"> };
  });
}

const scannerSummary = (commitSha: string) => ({ scanner: "builditRules", scannerVersion: "combined", commitSha, complete: true,
  runs: [{ scanner: "builditRules", scannerVersion: "1.0.0" }, { scanner: "gitleaks", scannerVersion: "8.28.0" }, { scanner: "osvScanner", scannerVersion: "2.2.3" }], findings: [] });

/** Answers as the broker would, one segment at a time, and records what it was asked for. */
function broker(options: { proveTeardown?: boolean; testExit?: number } = {}) {
  const segments: ExecutionSegment[] = [];
  const side = (segment: ExecutionSegment, revision: "base" | "head") => {
    const failing = segment.planId === "test" && options.testExit === 1;
    return {
      ...(segment.stage === "prepare" ? { credentialTeardownProved: options.proveTeardown ?? true } : {}),
      ...(segment.stage === "compare" ? { stopped: true } : {}),
      results: segment.stage === "install" ? [{ ...plans.install, conclusion: "passed", exitCode: 0, durationMs: 5 }]
        : segment.stage === "checks" ? [{ ...plans.checks.find(plan => plan.planId === segment.planId)!, conclusion: failing ? "failed" : "passed", exitCode: failing ? 1 : 0, durationMs: 5 }] : [],
      outputs: ["install", "checks"].includes(segment.stage) ? [{ planId: segment.planId ?? "install", text: `${revision}-output`, truncated: false, evidenceTruncated: false }] : [],
      diagnostics: segment.stage === "install" ? { install: [{ conclusion: "passed" }] }
        : segment.stage === "checks" ? { [segment.planId!]: [{ conclusion: failing ? "failed" : "passed", ...(failing ? { failureFingerprint: "f".repeat(64) } : {}) }] }
        : segment.stage === "diagnostics" ? { [segment.planId!]: [{ conclusion: "passed" }] } : {},
    };
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/artifacts") && init?.method !== "PUT") {
      const grant = String((init?.headers as Record<string, string>).authorization).slice(7);
      const claims = JSON.parse(Buffer.from(grant.split(".")[0]!, "base64url").toString("utf8")) as { storageKey: string };
      return new Response(snapshot(/context-base-/.test(claims.storageKey) ? "base" : "head"));
    }
    if (url.endsWith("/api/artifacts")) return Response.json({ stored: true });
    const body = JSON.parse(String(init!.body)) as { segment: ExecutionSegment };
    segments.push(body.segment);
    return Response.json({ segment: body.segment, base: side(body.segment, "base"), head: side(body.segment, "head"),
      ...(body.segment.stage === "scanners" ? { scanners: { base: scannerSummary(base), head: scannerSummary(head) } } : {}) });
  });
  return { fetchMock, segments };
}

function environment() {
  vi.stubEnv("BUILDIT_BROKER_URL", "https://broker.example");
  vi.stubEnv("ARTIFACT_GRANT_SECRET", Buffer.alloc(32, 7).toString("base64url"));
  vi.stubEnv("EXECUTION_GRANT_SECRET", Buffer.alloc(32, 9).toString("base64url"));
}

// One /api/execute call used to carry install, three checks and every rerun for both revisions,
// which is 700 seconds of sandbox lifetime and needed a maxDuration of 800. The plan did not shrink;
// the call did.
describe("a review split across invocations", () => {
  it("sends one request per segment and one check pair per checks request", async () => {
    const t = convexTest(schema, modules), scope = await seed(t), { fetchMock, segments } = broker();
    environment();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await t.action(validate, { organizationId: scope.organizationId, reviewId: scope.reviewId, expectedHeadSha: head, expectedGeneration: 0 });
      expect(result).toMatchObject({ manager: "pnpm", reused: false, segments: 7 });
      expect(segments.map(segment => `${segment.stage}:${segment.planId ?? ""}`)).toEqual([
        "prepare:", "scanners:", "install:", "checks:test", "checks:lint", "checks:typecheck", "compare:",
      ]);
      // Each checks request carries exactly one plan, which is what keeps a segment inside 300
      // seconds: install plus test plus a rerun is 450 on its own.
      for (const segment of segments.filter(item => item.stage === "checks")) expect(segment.revisions).toEqual(["base", "head"]);
      const job = await t.run(ctx => ctx.db.query("executionJobs").collect());
      expect(job).toHaveLength(1);
      expect(job[0]).toMatchObject({ status: "completed", stage: "complete" });
      // Fourteen checkRuns: install, three checks and three scanners on each revision.
      expect(await t.run(ctx => ctx.db.query("checkRuns").collect())).toHaveLength(14);
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });

  // A rerun exists to tell a genuine failure from a flaky one, and it is now its own invocation
  // because a check plus its rerun is 300 seconds of the 300 available.
  it("gives a failed required check its rerun in a separate invocation", async () => {
    const t = convexTest(schema, modules), scope = await seed(t), { fetchMock, segments } = broker({ testExit: 1 });
    environment();
    vi.stubGlobal("fetch", fetchMock);
    try {
      await t.action(validate, { organizationId: scope.organizationId, reviewId: scope.reviewId, expectedHeadSha: head, expectedGeneration: 0 });
      const diagnostics = segments.filter(segment => segment.stage === "diagnostics");
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({ planId: "test", revisions: ["base", "head"] });
      // Failed then passed on the rerun is flaky, and both derivations have to say so.
      const runs = await t.run(ctx => ctx.db.query("checkRuns").collect());
      expect(runs.filter(run => run.kind === "test").map(run => run.conclusion)).toEqual(["flaky", "flaky"]);
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });

  // The proof that no credential is reachable inside either sandbox is made by `prepare` alone. It
  // has to reach the finishing segment across six more requests to a stateless broker, so it is
  // stamped on the durable cursor and read back from there rather than from this process's memory.
  it("carries the credential teardown proof on the job record", async () => {
    const t = convexTest(schema, modules), scope = await seed(t), { fetchMock } = broker();
    environment();
    vi.stubGlobal("fetch", fetchMock);
    try {
      await t.action(validate, { organizationId: scope.organizationId, reviewId: scope.reviewId, expectedHeadSha: head, expectedGeneration: 0 });
      const job = (await t.run(ctx => ctx.db.query("executionJobs").collect()))[0]!;
      expect(credentialTeardownRevisions(job.cursor)).toEqual(["base", "head"]);
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });

  // A failed segment leaves the record on a real stage, and its evidence in a process that is gone.
  // The first checkpoint used to assume version 1 and stage prepare, so a retry of the same
  // generation re-ran every segment and then lost the finished review to execution_checkpoint_conflict
  // at the very last one - ten minutes of sandbox spent to reach the same failure.
  it("refuses a retry of a job that already advanced, instead of re-running it to the same conflict", async () => {
    const t = convexTest(schema, modules), scope = await seed(t), { fetchMock, segments } = broker();
    environment();
    vi.stubGlobal("fetch", fetchMock);
    try {
      await t.run(async ctx => {
        const jobKey = `validation:${String(scope.reviewId)}:0:${head}`;
        await ctx.db.insert("executionJobs", { organizationId: scope.organizationId, repositoryId: scope.repositoryId, reviewId: scope.reviewId,
          jobKey, runId: runIdFor(String(scope.reviewId), 0), expectedHeadSha: head, baseSha: base, expectedGeneration: 0,
          stage: "checks", cursor: "checks:0:test", stateVersion: 4, attempt: 1, status: "failed",
          artifactIds: [], createdAt: Date.now(), updatedAt: Date.now() });
      });
      await expect(t.action(validate, { organizationId: scope.organizationId, reviewId: scope.reviewId, expectedHeadSha: head, expectedGeneration: 0 })).rejects.toThrow("execution_segments_not_resumable");
      expect(segments).toEqual([]);
      expect((await t.run(ctx => ctx.db.query("executionJobs").collect()))[0]).toMatchObject({ failureCode: "validation_not_resumable" });
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });

  // A prepare that failed leaves the stage where it was and the version one higher, so this retry is
  // the one that must work - and it is the reason the first checkpoint reads its version off the
  // claim rather than assuming 1.
  it("retries a job whose only failure was prepare, from the version the record is actually on", async () => {
    const t = convexTest(schema, modules), scope = await seed(t), { fetchMock, segments } = broker();
    environment();
    vi.stubGlobal("fetch", fetchMock);
    try {
      await t.run(async ctx => {
        const jobKey = `validation:${String(scope.reviewId)}:0:${head}`;
        await ctx.db.insert("executionJobs", { organizationId: scope.organizationId, repositoryId: scope.repositoryId, reviewId: scope.reviewId,
          jobKey, runId: runIdFor(String(scope.reviewId), 0), expectedHeadSha: head, baseSha: base, expectedGeneration: 0,
          stage: "prepare", cursor: "failure:validation_runner_failed", stateVersion: 2, attempt: 1, status: "failed",
          artifactIds: [], createdAt: Date.now(), updatedAt: Date.now() });
      });
      await expect(t.action(validate, { organizationId: scope.organizationId, reviewId: scope.reviewId, expectedHeadSha: head, expectedGeneration: 0 })).resolves.toMatchObject({ segments: 7 });
      expect(segments.map(segment => segment.stage)[0]).toBe("prepare");
      expect((await t.run(ctx => ctx.db.query("executionJobs").collect()))[0]).toMatchObject({ status: "completed", attempt: 2 });
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });

  it("refuses to run a second segment when prepare did not prove teardown", async () => {
    const t = convexTest(schema, modules), scope = await seed(t), { fetchMock, segments } = broker({ proveTeardown: false });
    environment();
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(t.action(validate, { organizationId: scope.organizationId, reviewId: scope.reviewId, expectedHeadSha: head, expectedGeneration: 0 })).rejects.toThrow("credential_teardown_unproved");
      expect(segments.map(segment => segment.stage)).toEqual(["prepare"]);
      expect((await t.run(ctx => ctx.db.query("executionJobs").collect()))[0]).toMatchObject({ status: "failed" });
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
});
