import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { landingSegments } from "../../apps/web/src/app/landing-segments";
import { publicRoutes } from "../../apps/web/src/app/public-routes";
import record from "../../apps/web/src/app/track-record.json";
import { pinPullRequest, reviewPolicy } from "../../packages/github/src/index";

// The landing page answers four first questions, one per kind of team BuildIT is for. Each answer
// is a claim about behaviour, and copy that describes a control has to change with the control - so
// the claims that a rule makes true are asserted against that rule, not against the sentence.
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const pageFile = (path: string) => `../../apps/web/src/app${path === "/" ? "" : path}/page.tsx`;
const segment = (who: string) => {
  const found = landingSegments.find(item => item.who === who);
  if (!found) throw new Error(`no landing segment for ${who}`);
  return found;
};

describe("what the landing page tells each kind of team", () => {
  it("answers the four teams BuildIT is for, once each", () => {
    expect(landingSegments.map(item => item.who)).toEqual(["Startup teams", "Scale-ups", "Solo developers", "Open-source maintainers"]);
  });

  it("sends every answer to a public page, at an anchor that page actually has", () => {
    for (const item of landingSegments) {
      const [path, anchor] = item.href.split("#");
      expect(publicRoutes as readonly string[], item.href).toContain(path);
      if (anchor) expect(read(pageFile(path!)), item.href).toContain(`"${anchor}"`);
    }
  });

  it("types no number into a claim; the track record supplies them", () => {
    // track-record.test.ts fails the build when that file is a fortnight stale. A digit typed here
    // would have no such gate, which is how /features said 141 reviews for a month after it was 220.
    const source = read("../../apps/web/src/app/landing-segments.ts").replace(/\$\{record\.\w+\}/g, "");
    expect(source).not.toMatch(/\d/);
    expect(segment("Startup teams").answer).toContain(`${record.decisive} of ${record.reviews} reviews`);
  });

  it("only promises a maintainer what fork policy enforces", () => {
    const answer = segment("Open-source maintainers").answer;
    expect(answer).toMatch(/never automatically/);
    expect(answer).toMatch(/write access/);
    expect(answer).toMatch(/never with a fix pushed/);
    const fork = pinPullRequest({ number: 1, head: { sha: "a".repeat(40), ref: "feature", repoFullName: "stranger/fork" }, base: { sha: "b".repeat(40), ref: "main", repoFullName: "owner/repo" } });
    expect(reviewPolicy(fork, "review", "manual_review_only", "automatic").allowed).toBe(false);
    for (const permission of ["read", "triage"] as const) expect(reviewPolicy(fork, "review", "manual_review_only", permission).allowed).toBe(false);
    expect(reviewPolicy(fork, "autofix", "manual_review_only", "admin").allowed).toBe(false);
    expect(reviewPolicy(fork, "review", "manual_review_only", "write").allowed).toBe(true);
  });

  it("only promises a scale-up the roles and the audit chain that exist", () => {
    const answer = segment("Scale-ups").answer;
    expect(answer).toMatch(/four roles/);
    const roles = read("../../convex/validators.ts").match(/export const role = v\.union\(([\s\S]*?)\);/)?.[1] ?? "";
    expect(roles.match(/v\.literal\(/g)).toHaveLength(4);
    expect(answer).toMatch(/hash-chained/);
    // The audit list recomputes each event's digest and checks it against its predecessor's hash,
    // which is what makes "an edited entry shows" true rather than a property of the storage.
    const audit = read("../../convex/audit.ts");
    expect(audit).toMatch(/event\.previousHash !== previous/);
    expect(audit).toMatch(/await eventDigest\(event\) !== event\.eventHash/);
  });
});
