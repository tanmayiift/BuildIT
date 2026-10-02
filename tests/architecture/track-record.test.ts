import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import record from "../../apps/web/src/app/track-record.json";

// The trust page claimed "nine reviews across two repositories" long after it was a hundred across
// five. A number typed into prose goes stale the moment the thing it describes moves, and a stale
// number on a trust page is worse than none: it is a measurable claim that is measurably wrong.
//
// So the number has one home, generated from production by scripts/track-record.mjs, and the pages
// render from it. These guard the property that made the old line rot - that a human could type a
// figure straight into the copy.
const read = (path: string) => readFileSync(join(import.meta.dirname, "../..", path), "utf8");

describe("the track record has one source", () => {
  const features = read("apps/web/src/app/features/page.tsx");
  const trust = read("apps/web/src/app/data-handling/page.tsx");

  it("is generated with every field the pages render", () => {
    for (const field of ["repositories", "reviews", "decisive", "platformFailed", "sinceLastPlatformFailure", "lastPlatformFailureAt"]) {
      expect(record).toHaveProperty(field);
    }
    expect(record.reviews).toBeGreaterThan(0);
    expect(record.decisive).toBeLessThanOrEqual(record.reviews);
    expect(record.platformFailed).toBeLessThanOrEqual(record.reviews);
  });

  // Single-source was never the whole problem. The file was stamped 2026-09-05 and said 141 reviews
  // while production had reached 220 - correct in shape, 56% wrong in substance, and every assertion
  // above passed throughout. A generated number rots exactly as quietly as a typed one if nothing
  // checks when it was generated.
  //
  // Fourteen days, not thirty. The first version of this assertion used thirty and would have passed
  // the very file that motivated it: 5 September to 2 October is twenty-seven days. Any window is a
  // compromise - the honest fix is regenerating on a schedule - but it has to be shorter than the
  // staleness it exists to catch, or it is decoration.
  const maximumRecordAgeDays = 14;
  it("was generated recently enough to still be true", () => {
    const generatedAt = Date.parse(`${record.generatedAt}T00:00:00Z`);
    expect(Number.isFinite(generatedAt), "generatedAt must be a date the build can check").toBe(true);
    const days = (Date.now() - generatedAt) / 86_400_000;
    expect(days, `track-record.json is ${Math.floor(days)} days old - run pnpm evidence:track-record`).toBeLessThan(maximumRecordAgeDays);
    expect(days, "generatedAt is in the future, which is not a record of anything").toBeGreaterThanOrEqual(-1);
  });

  it("uses a window shorter than the staleness it was written to catch", () => {
    // The observed failure was 27 days. A window at or above that cannot see it.
    expect(maximumRecordAgeDays).toBeLessThan(27);
  });

  // The file carried platformFailed from the start and /features quoted only the flattering figures
  // beside it. 85 of 220 reviews failed on BuildIT's own side; a page that cites the other two
  // numbers and drops that one is selecting its evidence.
  it("renders the platform failure count wherever it renders the review count", () => {
    for (const page of [features, trust]) {
      expect(page, "a page citing review counts must also cite the failures").toContain("record.platformFailed");
    }
  });

  it("is read from the file on both pages, never retyped", () => {
    for (const page of [features, trust]) {
      expect(page).toContain("track-record.json");
      expect(page).toContain("record.reviews");
      expect(page).toContain("record.repositories");
    }
  });

  // The specific sentence that rotted, and any successor shaped like it.
  it("states no review or repository count as a literal in the copy", () => {
    for (const page of [features, trust]) {
      expect(page).not.toMatch(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+reviews?\s+across\b/i);
      expect(page).not.toMatch(/\bacross\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+repositor/i);
    }
  });
});
