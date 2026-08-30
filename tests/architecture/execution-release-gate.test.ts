import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("repository execution release gate", () => {
  it("guards both dashboard and GitHub command entry points", () => {
    for (const path of ["convex/dashboardReviews.ts", "convex/githubWebhookProcessor.ts"]) {
      const value = source(path);
      expect(value).toContain('import { requireExecutionEnabled } from "./lib/executionGate"');
      expect(value).toContain("requireExecutionEnabled();");
    }
  });

  it("drives setup and consent controls from the authenticated server query", () => {
    const connections = source("apps/web/src/app/live-connections.tsx"), starter = source("apps/web/src/app/reviews/dashboard-review-start.tsx");
    expect(connections).toContain('("runtimeReadiness:current")');
    expect(connections).toContain('detail={readiness?.executionEnabled ? "Release gate passed" : "Safety blocked"}');
    expect(starter).toContain('("runtimeReadiness:current")');
    expect(starter).toContain("disabled={working || !readiness?.executionEnabled}");
    expect(starter).toContain('"Review execution safety-blocked"');
  });
});
