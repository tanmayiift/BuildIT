import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sampleReviews, sampleReviewFor } from "../../apps/web/src/app/sample-data";

// The queue said nexus/web #22 and the detail page said nexus/api, because each route carried its
// own copy of the sample data. When the same fact lives in two places the fix is to make one place
// read from the other, not to correct both - so this asserts the reading, not the values.
//
// It runs in `pnpm verify` rather than only in Playwright: a fixture that drifts should fail the
// build in seconds, not after a browser boot.
const root = join(import.meta.dirname, "../..");
const queueRoute = readFileSync(join(root, "apps/web/src/app/reviews/page.tsx"), "utf8");
const detailRoute = readFileSync(join(root, "apps/web/src/app/reviews/[id]/page.tsx"), "utf8");

describe("one sample fixture, read by both routes", () => {
  it("gives every sample a distinct pull request, commit and repository line", () => {
    expect(new Set(sampleReviews.map(review => review.pr)).size).toBe(sampleReviews.length);
    expect(new Set(sampleReviews.map(review => review.commit)).size).toBe(sampleReviews.length);
    // Four rows that all render the same verdict is the defect this whole fixture exists to stop.
    expect(new Set(sampleReviews.map(review => review.state)).size).toBe(sampleReviews.length);
  });

  // #91 advertised "1 medium" in the queue while its page said BuildIT had read nothing. The row
  // and the page disagreed because nothing forced them to agree, and the number was invisible in
  // the UI so nobody caught it. This is the rule that number would have broken.
  it("never lets a review with no evidence advertise a result", () => {
    for (const review of sampleReviews.filter(item => item.state === "empty")) {
      const claims = Object.entries(review).filter(([key, value]) =>
        !["pr", "commit", "baseCommit", "age"].includes(key) && typeof value === "string" && /\b\d+\b/.test(value) && !/^0\b/.test(value));
      expect(claims, `#${review.pr} claims a count while showing no evidence: ${JSON.stringify(claims)}`).toEqual([]);
      expect(review.checks, `#${review.pr} lists checks while showing no evidence`).toBeUndefined();
      expect(review.finding, `#${review.pr} cites a finding while showing no evidence`).toBeUndefined();
    }
  });

  // An inconclusive review that does not say what stopped it leaves a person with nothing to do.
  it("gives every inconclusive sample a cause and a way to clear it", () => {
    for (const review of sampleReviews.filter(item => item.status === "Inconclusive")) {
      expect(review.cause?.reason, `#${review.pr} has no recorded cause`).toBeTruthy();
      expect(review.cause?.nextStep, `#${review.pr} has no next step`).toBeTruthy();
    }
    // And the page must read it, not restate it.
    expect(detailRoute).toContain("row?.cause?.reason");
    expect(detailRoute).toContain("row?.cause?.detail");
  });

  it("resolves every queue row to a detail row that matches it exactly", () => {
    for (const review of sampleReviews) {
      const resolved = sampleReviewFor(String(review.pr));
      expect(resolved, `#${review.pr} does not resolve`).toBeDefined();
      expect(resolved!.repo, `#${review.pr} repository`).toBe(review.repo);
      expect(resolved!.pr, `#${review.pr} number`).toBe(review.pr);
      expect(resolved!.commit, `#${review.pr} commit`).toBe(review.commit);
      expect(resolved!.status, `#${review.pr} status`).toBe(review.status);
    }
  });

  it("keeps both routes reading the fixture instead of hardcoding a sample", () => {
    expect(queueRoute).toContain("sampleReviews");
    expect(detailRoute).toContain("sampleReviewFor");
    // Any repository, commit or pull-request number written as a literal in a route is a second
    // source of truth, which is how the two drifted apart in the first place.
    for (const route of [queueRoute, detailRoute]) {
      for (const review of sampleReviews) {
        expect(route, `"${review.repo}" is hardcoded in a route`).not.toContain(`>${review.repo}<`);
        expect(route, `"${review.commit}" is hardcoded in a route`).not.toContain(review.commit);
      }
    }
  });

  it("matches the recorded review it claims to transcribe", () => {
    const record = readFileSync(join(root, "docs/evidence/sample-tour-transcript-2026-09-03.md"), "utf8");
    const finding = sampleReviews.find(review => review.finding)!.finding!;
    for (const [name, value] of Object.entries({
      commit: finding.commit,
      location: `${finding.path}:${finding.lines}`,
      title: finding.title,
      stackedPr: finding.stackedPr.href,
      source: finding.source.href,
      reviewedAt: finding.reviewedAt,
    })) {
      expect(record, `${name} "${value}" is not in the recorded review`).toContain(value);
    }
  });

  it("keeps the one complete finding traceable to a real review", () => {
    const complete = sampleReviews.filter(review => review.finding);
    expect(complete).toHaveLength(1);
    const finding = complete[0]!.finding!;
    // Every piece an engineer needs to check the claim, and a real pull request behind the fix.
    for (const [name, value] of Object.entries({ path: finding.path, lines: finding.lines,
      excerpt: finding.excerpt, why: finding.why, checkOutput: finding.checkOutput, fix: finding.fix })) {
      expect(value.trim(), `${name} is empty`).not.toBe("");
    }
    expect(finding.stackedPr.href).toMatch(/^https:\/\/github\.com\/[\w-]+\/[\w-]+\/pull\/\d+$/);
    // The excerpt has to come from the file the finding cites, not from somewhere else.
    expect(finding.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The proposed change has to touch the line the finding cites, or the diff is about something
    // else - which is precisely the mistake this fixture is replacing.
    expect(finding.fix).toContain("rejectUnauthorized");
    expect(finding.excerpt).toContain("rejectUnauthorized");
  });
});
