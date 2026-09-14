"use node";
import { createHash } from "node:crypto";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { issueExecutionGrant } from "@buildit/security";

// The other half of the sweep. reconcileWorker can declare an execution job dead inside its
// transaction; it cannot stop the sandbox that job opened, because a Convex mutation cannot call
// the sandbox SDK and this deployment holds no Vercel credentials to call it with - the broker
// mints those per request from its own OIDC token, which only exists inside a broker request. So
// the sweeper writes the intent to the row and this drains it.
//
// The broker route this calls owns exactly one thing on the far side, in packages/runner:
//
//   export async function reclaimJobSandboxes(
//     jobKey: string,
//     credentials: SandboxCredentials,
//   ): Promise<{ released: boolean; stopped: number }>
//
// A job key names two sandboxes, not one - executionSandboxName(jobKey, revision) for each of
// executionRevisions, because base and head are executed separately. The function must derive both
// names itself rather than accept them (that derivation is already the reason a caller cannot
// address another review's sandbox), find them in Sandbox.list() - which the `buildit: execution`
// tag narrows - stop each, and report released:true only when neither is left running. A sandbox
// that was already gone counts as released: it is the goal state, and treating it as a failure
// would keep this row retrying for something that no longer exists. Only the keys sent here are
// dead, so nothing may be stopped by pattern or by age - a live review's sandbox looks identical.

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// One request per job rather than one per batch. An execution grant is scoped to a single review's
// organization, repository and commits - there is no cross-tenant shape for it, and inventing one
// would mean a single stolen token could stop another workspace's sandboxes.
export const reclaim = internalAction({
  args: {},
  handler: async (ctx): Promise<{ pending: number; released: number; failed: number }> => {
    const pending = await ctx.runQuery(internal.executionJobsData.listAbandonedSandboxes, { limit: 25 });
    if (pending.length === 0) return { pending: 0, released: 0, failed: 0 };
    const brokerUrl = required("BUILDIT_BROKER_URL").replace(/\/$/, ""), secret = Buffer.from(required("EXECUTION_GRANT_SECRET"), "base64url");
    let released = 0, failed = 0;
    for (const job of pending) {
      const body = { jobKey: job.jobKey, operation: "sandbox_reclaim" as const };
      let ok = false;
      try {
        const grant = issueExecutionGrant({
          organizationId: String(job.organizationId), repositoryId: String(job.repositoryId), reviewId: String(job.reviewId),
          baseSha: job.baseSha, headSha: job.headSha,
          // The grant's two hashes bind the request body, exactly as they do for /api/execute: the
          // broker recomputes them and refuses a token replayed against a different job key.
          artifactsHash: digest(body), plansHash: digest({ operation: body.operation }),
        }, secret, Date.now());
        const response = await fetch(`${brokerUrl}/api/sandboxes`, {
          method: "POST", headers: { authorization: `Bearer ${grant}`, "content-type": "application/json" },
          body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
        });
        // 404 means the broker looked and there is no such sandbox, which is the goal state. Only a
        // reply that actually says released keeps a row from being retried, so a broker that is
        // down leaves the intent on the row instead of losing it.
        if (response.status === 404) ok = true;
        else if (response.ok) ok = ((await response.json().catch(() => null)) as { released?: boolean } | null)?.released === true;
      } catch { ok = false; }
      await ctx.runMutation(internal.executionJobsData.recordSandboxReclaim, { jobId: job.jobId, released: ok, now: Date.now() });
      if (ok) released += 1; else failed += 1;
    }
    return { pending: pending.length, released, failed };
  },
});
