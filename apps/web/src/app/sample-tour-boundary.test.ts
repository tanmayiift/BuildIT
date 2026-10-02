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

// The tour context used to be provided inside WorkspaceRouteBoundary, which wraps only <main>. The
// sidebar and the connection banner sit outside it, read the default, and showed a signed-in
// visitor their real identity, workspaces and repository count beside the sample-tour note.
describe("the tour reaches the whole workspace chrome", () => {
  const shell = readFileSync("apps/web/src/app/app-shell.tsx", "utf8");

  it("is provided around the chrome, not just the page body", () => {
    expect(shell).toMatch(/<SampleTourProvider><WorkspaceShell>/);
    expect(readFileSync("apps/web/src/app/workspace-route-boundary.tsx", "utf8")).not.toMatch(/SampleTourContext\.Provider value=\{?(true|false)?\}?>\s*<p/);
  });

  // Every live component the chrome mounts outside <main>, and the hook each must consult before
  // asking Convex anything. A new one added to the sidebar without the hook fails here.
  const chrome: Record<string, { file: string; consults: RegExp }> = {
    AccountStatus: { file: "account-status.tsx", consults: /useSampleTour\(\)/ },
    WorkspaceSwitcher: { file: "workspace-switcher.tsx", consults: /useSampleTour\(\)/ },
    ConnectionBanner: { file: "live-connections.tsx", consults: /export function ConnectionBanner\(\) \{\s*const tour = useSampleTour\(\), live = useConnection\(\);\s*const connection = tour \? signedOutConnection : live;/ },
    SetupProgress: { file: "live-connections.tsx", consults: /export function SetupProgress\(\) \{\s*const tour = useSampleTour\(\), live = useConnection\(\);\s*const connection = tour \? signedOutConnection : live;/ },
  };

  // The banner and the setup meter treat the tour as signed out outright, so even the e2e design
  // fixture cannot put a connected-workspace claim in the chrome around a tour.
  it("names every live component the chrome mounts", () => {
    const mounted = [...shell.matchAll(/<([A-Z]\w+)[\s/>]/g)].map(match => match[1]);
    const live = mounted.filter(name => !["SampleTourProvider", "WorkspaceShell", "WorkspaceRouteBoundary", "PublicShell", "NavLink", "BrandGlyph"].includes(name!));
    expect(new Set(live)).toEqual(new Set(Object.keys(chrome)));
  });

  for (const [name, { file, consults }] of Object.entries(chrome)) {
    it(`${name} consults the tour before reading live data`, () => {
      expect(readFileSync(`apps/web/src/app/${file}`, "utf8")).toMatch(consults);
    });
  }
});

describe("useConnection, which the banner and setup meter share", () => {
  it("asks Convex nothing under the tour", () => {
    expect(source).toMatch(/useQuery\(connectionQuery, hydrated && isAuthenticated && !sampleTour \? \{\} : "skip"\)/);
  });
});
