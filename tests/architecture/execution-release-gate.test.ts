import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("repository execution release gate", () => {
  it("guards both dashboard and GitHub command entry points", () => {
    for (const path of ["convex/dashboardReviews.ts", "convex/githubWebhookProcessor.ts"]) {
      const value = source(path);
      expect(value).toMatch(/import \{[^}]*\brequireExecutionEnabled\b[^}]*\} from "\.\/lib\/executionGate"/);
      expect(value).toContain("requireExecutionEnabled();");
    }
  });

  // Every GitHub-triggered review - comment or automatic - starts through startReviewForPullRequest,
  // so the gate is its first statement rather than something each caller must remember. The
  // behaviour itself is proven in convex/automaticReview.test.ts.
  it("gates the one path every GitHub-triggered review takes, before anything else", () => {
    const value = source("convex/githubWebhookProcessor.ts");
    const body = value.slice(value.indexOf("async function startReviewForPullRequest"));
    const firstStatement = body.slice(body.indexOf("{") + 1).split("\n").map(line => line.trim()).find(line => line && !line.startsWith("//"));
    expect(firstStatement).toBe("requireExecutionEnabled();");
  });

  it("drives setup and consent controls from the authenticated server query", () => {
    const connections = source("apps/web/src/app/live-connections.tsx"), starter = source("apps/web/src/app/reviews/dashboard-review-start.tsx");
    expect(connections).toContain('("runtimeReadiness:current")');
    // Assert the guarantee, not one exact expression: the row must be driven by the server
    // query and must not claim a verdict before that query resolves.
    expect(connections).toContain('"Release gate passed"');
    expect(connections).toContain('signedIn && readiness === undefined ? "Checking"');
    expect(starter).toContain('("runtimeReadiness:current")');
    expect(starter).toContain("readiness === undefined");
    expect(starter).toContain("readiness.executionEnabled");
    expect(starter).toContain('"Review execution safety-blocked"');
  });
});
