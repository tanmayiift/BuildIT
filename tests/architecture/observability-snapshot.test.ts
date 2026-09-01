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
    for (const name of ["queue_depth", "active_reviews", "capacity_utilization", "expired_artifact_backlog", "model_cost_usd_hour", "budget_exhausted_reviews_hour", "effective_loc_delivered_hour"]) expect(worker).toContain(name);
    expect(worker).not.toMatch(/organizationId|repositoryId|reviewId|owner|email|source|prompt/);
  });
});
