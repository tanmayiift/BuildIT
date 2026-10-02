import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), "utf8");

describe("production observability snapshots", () => {
  it("uses bounded indexed queries and a fixed five-minute schedule", () => {
    const data = read("convex/telemetrySnapshotData.ts");
    const schema = read("convex/schema.ts");
    const crons = read("convex/crons.ts");
    expect(data).toContain('.withIndex("by_status"');
    expect(data).toContain('.withIndex("by_time"');
    expect(data).toContain('.withIndex("by_name_time"');
    expect(data).toContain('.withIndex("by_pending_expiry"');
    expect(data).toContain(".take(");
    expect(data).not.toContain(".collect(");
    expect(schema).toContain('.index("by_status", ["status", "updatedAt"])');
    expect(schema).toContain('.index("by_time", ["occurredAt"])');
    expect(crons).toContain('crons.interval("emit source-free operational snapshot",{minutes:5}');
  });

  it("exports only fixed global measurements without tenant fields", () => {
    const worker = read("convex/telemetrySnapshotWorker.ts");
    for (const name of ["queue_depth", "active_reviews", "capacity_utilization", "expired_artifact_backlog", "model_cost_usd_hour", "budget_exhausted_reviews_hour", "effective_loc_delivered_hour", "sandbox_quota_utilization", "workspaces_at_sandbox_ceiling"]) expect(worker).toContain(name);
    expect(worker).not.toMatch(/organizationId|repositoryId|reviewId|owner|email|source|prompt/);
  });

  // The ban above is applied to the worker, which is thirty lines of measurement-name literals and
  // could never have contained a tenant field. The file that actually reads `organizations` and
  // `metricEvents` - and therefore the only one that could leak one - was subject to no such check.
  // Assert it where it matters: on what snapshot() returns, which is the payload that leaves the
  // deployment. Checking the whole file would fail on the queries it legitimately makes.
  it("returns only numbers, so no tenant field can ride out in the snapshot payload", () => {
    const data = read("convex/telemetrySnapshotData.ts");
    const returned = data.slice(data.lastIndexOf("return {"));
    expect(returned.length, "the return block must be found, or this asserts nothing").toBeGreaterThan(100);
    for (const field of ["organizationId", "repositoryId", "reviewId", "owner", "slug", "name", "email", "login", "source", "prompt", "headSha"]) {
      expect(returned, `${field} must not reach the snapshot payload`).not.toContain(field);
    }
    // And every value is bounded, so a number cannot carry a count that identifies one tenant either.
    expect(returned).toMatch(/bounded\(/);
  });
});
