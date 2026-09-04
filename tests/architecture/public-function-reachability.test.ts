import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { publicFunctionPolicies } from "../../convex/publicFunctionPolicy";

// `memberships:accept` was written, authorized, policy-declared and unit-tested, and no screen in
// the product ever called it. Inviting a teammate wrote a membership row with status "invited",
// and nothing in the interface could ever turn it into "active" - so every invitation BuildIT has
// ever sent was a dead end, and the whole suite stayed green while that was true.
//
// It was not one mistake. `findings:dismiss` is the suppression path the review loop is supposed
// to learn from, reachable by nobody. `organizations:updateCapacity` was written with a comment
// above it saying a limit that cannot be raised is an outage waiting for its first customer, and
// then shipped with no control that raises it. `audit:verifyChain`, `reviews:get`,
// `organizations:clearActive`, `artifacts:getMetadata` and both tracker-connection endpoints are
// the same shape.
//
// Each one passed its convex/ unit tests, passed the authorization and response declarations in
// public-function-inventory.test.ts, and passed review. Those tests ask whether the function is
// correct and whether it is declared. Nothing asked the only question that would have caught any
// of them: can a person actually get here?
//
// This asks it. A public function is reachable when apps/web/src names it, or when the broker
// calls it server-to-server. Anything else has to be written down below with the sentence saying
// what is missing - so the debt is visible instead of invisible, and the build breaks on the day
// the next one appears rather than on the day a customer finds it.

// Every entry is a feature that exists on the server and cannot be reached by a customer. The
// reason is the gap, not an excuse: when the gap closes, the entry is deleted, and the test below
// fails until it is.
const deliberatelyUnreferenced: Record<string, string> = {
  "artifacts:getMetadata": "no screen shows an artifact's size, redaction status or expiry - the review page renders evidence only.",
  "audit:verifyChain": "the audit log is listed but never verified, so a customer cannot tell a sound hash chain from a tampered one.",
  "integrations:listTrackerConnections": "the broker can create a Jira or Linear connection, but no admin screen lists what is connected.",
  "integrations:revokeTrackerConnection": "and having never seen the connection, an admin cannot revoke it - a leaked tracker token has no customer-facing kill switch.",
  "memberships:accept": "invited teammates cannot join; no accept screen exists, so every invitation is a dead end.",
  "memberships:invite": "superseded by memberships:inviteByGitHubLogin, which the members panel calls - this by-userId variant has no caller left.",
  "organizations:clearActive": "the workspace switcher can select a workspace but never clear one, so there is no way back to having none active.",
  "organizations:updateCapacity": "no budget or concurrency control exists in the interface, so every organization is stuck on the limits it was seeded with.",
  "reviews:get": "the review page reads reviews:getEvidence, which returns the review as well - this narrower query has no caller.",
};

const convexDir = join(import.meta.dirname, "../../convex");
const webDir = join(import.meta.dirname, "../../apps/web/src");
const brokerDir = join(import.meta.dirname, "../../packages/broker/src");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? sources(join(dir, entry.name))
      : /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : []);
}

// Two conventions reach a Convex function from the browser: the makeFunctionReference<...>("a:b")
// constants declared at the top of every live-* component, and the api.module.name form. Both are
// collected, so moving between conventions can never quietly hide an endpoint from this test.
function webReferences() {
  const found = new Set<string>();
  for (const file of sources(webDir)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/makeFunctionReference\s*<[\s\S]*?>\s*\(\s*"([^"]+)"/g)) found.add(match[1]!);
    for (const match of source.matchAll(/\bapi\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\b/g)) found.add(`${match[1]}:${match[2]}`);
  }
  return found;
}

// The broker calls three credential mutations over /api/mutation, so they are reachable with no
// screen naming them. Matching any "module:function" literal against the policy keys, rather than
// against the name of the call helper, keeps that true if the helper is ever renamed - and a
// false positive would have to be a string equal to a real function name, which is not a mistake.
function brokerReferences() {
  const found = new Set<string>();
  for (const file of sources(brokerDir)) {
    for (const match of readFileSync(file, "utf8").matchAll(/"([A-Za-z0-9_]+:[A-Za-z0-9_]+)"/g)) found.add(match[1]!);
  }
  return found;
}

function exportedConvexFunctions() {
  const declaration = /export const\s+([A-Za-z0-9_]+)\s*=\s*(?:query|mutation|action)\s*\(/g;
  return new Set(readdirSync(convexDir).filter(file => file.endsWith(".ts") && !file.endsWith(".test.ts")).flatMap(file =>
    [...readFileSync(join(convexDir, file), "utf8").matchAll(declaration)]
      .map(match => `${basename(file, ".ts")}:${match[1]}`)));
}

describe("every function BuildIT declares customer-facing", () => {
  const web = webReferences(), broker = brokerReferences();
  const reachable = (name: string) => web.has(name) || broker.has(name);

  it("is reachable from the product, or written down as a gap", () => {
    const unreachable = Object.keys(publicFunctionPolicies)
      .filter(name => !reachable(name) && !(name in deliberatelyUnreferenced)).sort();
    expect(unreachable, "built, authorized and declared customer-facing, and nothing calls it - wire it into apps/web/src, or add it to deliberatelyUnreferenced with the sentence saying what is missing")
      .toEqual([]);
  });

  it("leaves the gap list the moment something calls it", () => {
    const closed = Object.keys(deliberatelyUnreferenced).filter(reachable).sort();
    expect(closed, "reachable now - delete the deliberatelyUnreferenced entry so the list keeps meaning 'nobody can get here'")
      .toEqual([]);
  });

  // A renamed or deleted function that leaves its excuse behind turns the list into fiction, and
  // the entry would then permanently exempt a name that no longer exists.
  it("is the only thing the gap list is allowed to name", () => {
    const unknown = Object.keys(deliberatelyUnreferenced).filter(name => !(name in publicFunctionPolicies)).sort();
    expect(unknown, "not a public function - the entry outlived what it described").toEqual([]);
  });
});

describe("every Convex function the web app names", () => {
  // The reference is a plain string, so a typo type-checks, lints, builds and deploys, and fails
  // for the first customer who opens the screen. This is the only place it can fail earlier.
  it("resolves to a function convex actually exports", () => {
    const exported = exportedConvexFunctions();
    const dangling = [...webReferences()].filter(name => !exported.has(name)).sort();
    expect(dangling, "named in apps/web/src and exported by nothing in convex/ - a typo that only surfaces at runtime").toEqual([]);
  });
});
