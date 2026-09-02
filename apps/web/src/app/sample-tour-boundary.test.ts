import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The tour promises "Sample tour · no live workspace data" and "BuildIT will not request live
// workspace data before authentication" on the same screen where clicking Pause fired a real
// mutation at the configured Convex deployment with a fixture id. That contradicts the product's
// own on-screen promise, and hands any anonymous visitor an unauthenticated write-attempt
// amplifier against the backend.

const source = readFileSync("apps/web/src/app/live-connections.tsx", "utf8");

describe("sample tour writes nothing", () => {
  it("checks the tour before every mutation a visitor can trigger", () => {
    // Each handler that can reach a mutation returns early under the tour.
    for (const handler of ["const save = async (repository: ConnectedRepository", "async function submitInvite(", "async function update(member: Member"]) {
      const start = source.indexOf(handler);
      expect(start, `${handler} not found`).toBeGreaterThan(-1);
      const body = source.slice(start, start + 600);
      const guard = body.indexOf("ampleTour");
      const call = Math.min(...["await updatePolicy(", "await invite(", "await remove(", "await changeRole("]
        .map(name => body.indexOf(name)).filter(index => index > -1).concat([Number.MAX_SAFE_INTEGER]));
      expect(guard, `${handler} has no sample-tour guard`).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(call);
    }
  });

  it("tells the visitor nothing was changed rather than faking success", () => {
    expect(source).toContain("Sample tour: no policy was changed");
    expect(source).toContain("Sample tour: no invitation was sent");
    expect(source).toContain("Sample tour: no member was changed");
  });

  // The identity-recovery copy was the catch-all for every failure, so an argument-validation
  // error on a fixture id told the user to refresh their GitHub identity - wrong, and in the tour
  // unactionable. Classify before advising, as model-key-state.ts already does.
  it("does not advise an identity refresh for an unrelated failure", () => {
    expect(source).toContain("export function policyFailureMessage");
    const start = source.indexOf("export function policyFailureMessage");
    const body = source.slice(start, start + 700);
    expect(body).toContain("recent_reauthentication_required");
    expect(body).toContain("not_found_or_forbidden");
    // The fallback must not mention verifying with GitHub.
    const fallback = body.slice(body.lastIndexOf("return "));
    expect(fallback).not.toMatch(/GitHub/);
  });
});
