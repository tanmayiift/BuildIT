import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import record from "../../docs/evidence/track-record.json";

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
    for (const field of ["repositories", "reviews", "decisive", "sinceLastPlatformFailure", "lastPlatformFailureAt"]) {
      expect(record).toHaveProperty(field);
    }
    expect(record.reviews).toBeGreaterThan(0);
    expect(record.decisive).toBeLessThanOrEqual(record.reviews);
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
