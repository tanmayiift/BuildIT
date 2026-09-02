import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every one of these feeds a live Convex subscription that re-executes on each matching write.
// An unbounded read there re-reads a tenant's whole history every time and eventually crosses
// Convex's per-query read limit, where the query does not degrade - it hard-fails. Because
// activation:funnel was a table scan, Convex also invalidated it on any write to findings by
// ANY tenant, re-running six unbounded reads for every open dashboard in the product.

const read = (path: string) => readFileSync(join("convex", path), "utf8");

describe("live query bounds", () => {
  it("bounds every read behind a public dashboard query", () => {
    for (const file of ["activation.ts", "reviews.ts", "usage.ts", "metrics.ts", "audit.ts"]) {
      const source = read(file);
      expect(source, `${file} still collects unbounded`).not.toMatch(/\.collect\(\)/);
    }
  });

  it("scopes every tenant read at the index, not in JavaScript afterwards", () => {
    // A .filter over a whole table reads every tenant's rows before discarding them.
    expect(read("activation.ts")).not.toMatch(/query\("findings"\)\.filter/);
    expect(read("reviewArtifactData.ts")).toContain('withIndex("by_org_provider"');
    expect(read("reviewArtifactData.ts")).not.toMatch(/query\("trackerConnections"\)\.withIndex\("by_status"/);
  });

  // One usageLedger row is written per model stage run, so a busy month is tens of thousands of
  // rows. Two to three ctx.db.get calls per row is past the read limit on its own.
  it("verifies each distinct parent once, not once per row", () => {
    for (const file of ["usage.ts", "metrics.ts"]) {
      const source = read(file);
      expect(source).toContain("parentScopeChecker(ctx");
      expect(source).not.toMatch(/for \(const \w+ of \w+\) \{[\s\S]{0,400}?await ctx\.db\.get\(/);
    }
  });

  it("does not re-read a table inside a loop over its own rows", () => {
    const source = read("reviewModelData.ts");
    // completeAnalysis accepts up to 500 requirements; re-collecting per item made it quadratic.
    expect(source).toContain("const existingRequirements = new Map(");
    expect(source).not.toMatch(/for \(const item of args\.requirements\)[\s\S]{0,300}?query\("requirements"\)/);
  });

  it("checks for a review's own metric events by review, not by organization", () => {
    expect(read("reviewAutofixData.ts")).toContain('withIndex("by_review_name"');
    expect(readFileSync("convex/schema.ts", "utf8")).toContain('.index("by_review_name", ["reviewId", "name"])');
  });

  // A guard against the next one. These tables are append-only and grow with usage, so an
  // unbounded read of any of them from a live query is the same defect again. The organization's
  // own memberships, repositories and installations are deliberately not on this list: they are
  // bounded by how many a company has, not by how long it has been a customer.
  it("never reads an append-only table unbounded from a public query", () => {
    const growing = ["usageLedger", "metricEvents", "auditEvents", "reviewEvents", "findings", "reviews", "artifacts", "checkRuns", "requirements", "authSessions"];
    const offenders: string[] = [];
    for (const name of readdirSync("convex").filter(file => file.endsWith(".ts") && !file.includes(".test."))) {
      const source = read(name);
      if (!/export const \w+ = query\(/.test(source)) continue;
      for (const table of growing) {
        // Only reads keyed on the tenant alone. A read keyed all the way down to one pull
        // request at one commit is bounded by the thing it is keyed to, not by tenant history.
        const pattern = new RegExp(`query\\("${table}"\\)\\.withIndex\\("[^"]+", [^;]{0,120}?organizationId[^;]{0,200}?\\.collect\\(\\)`);
        if (pattern.test(source)) offenders.push(`${name}: ${table}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
