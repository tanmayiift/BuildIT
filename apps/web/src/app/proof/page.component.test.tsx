// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPublicRoute, publicRoutes } from "../public-routes";
import { known } from "../../route-map";
import { publicFunctionPolicies } from "../../../../../convex/publicFunctionPolicy";
import type { ProofSummary } from "./page";

const state = vi.hoisted(() => ({ proof: undefined as unknown }));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: false, isLoading: false }),
  useQuery: (reference: string) => (reference === "publicProof:summary" ? state.proof : undefined),
}));
vi.mock("convex/server", () => ({ makeFunctionReference: (name: string) => name }));

const { default: Proof } = await import("./page");

// A realistic answer rather than a tidy one: reviews still running, two kinds of failure, and a
// spend small enough that a naive currency format would round it to zero.
function summary(overrides: Partial<ProofSummary> = {}): ProofSummary {
  return {
    generatedAt: Date.UTC(2026, 8, 5, 11, 30, 0),
    rowCeiling: 2_000,
    reviews: {
      counted: 134, truncated: false, repositoriesReviewed: 7,
      byStatus: {
        checks_passed: 41, changes_requested: 30, delivered: 7, inconclusive: 9,
        platform_failed: 42, failed_after_bounds: 3, cancelled: 1, analyzing: 1,
      },
    },
    findings: { counted: 318, truncated: false },
    spend: { modelSpendUsd: 12.4137, modelTokens: 4_812_663, counted: 940, truncated: false },
    ...overrides,
  };
}

beforeEach(() => { state.proof = undefined; });
afterEach(cleanup);

describe("the public proof page", () => {
  it("says it is reading production before the subscription resolves", () => {
    render(<Proof />);
    expect(screen.getByText("Reading production…")).toBeTruthy();
    // A skeleton showing plausible digits would be the exact defect this page exists to refuse.
    expect(document.body.textContent).not.toMatch(/\b\d{2,}\b/);
  });

  it("renders the real shape the query returns", () => {
    state.proof = summary();
    render(<Proof />);
    expect(screen.getByText("134")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("318")).toBeTruthy();
    expect(screen.getByText("$12.41")).toBeTruthy();
    // 41 + 30 + 7 decisive verdicts, computed from byStatus rather than sent by the server.
    expect(screen.getByText("78")).toBeTruthy();
    // Seconds under a minute and a half, minutes above it - both formats, from the real fields.
  });

  it("shows the unflattering numbers, not only the flattering ones", () => {
    state.proof = summary();
    render(<Proof />);
    expect(screen.getByText("Platform failures")).toBeTruthy();
    expect(screen.getAllByText("42").length).toBeGreaterThan(0);
    // Every recorded status appears in the distribution, including the ones nobody would put in a
    // pitch deck, and none of them is grouped into an "other" bucket.
    const mix = document.querySelector('dl[aria-labelledby="verdict-mix"]')!;
    for (const label of ["Checks passed", "Platform failure", "Failed after bounds", "Cancelled", "Inconclusive", "Analyzing"]) {
      expect(mix.textContent, label).toContain(label);
    }
    expect(mix.querySelectorAll("dt")).toHaveLength(Object.keys(summary().reviews.byStatus).length);
  });

  it("does not drop a status the server adds but the page has no label for", () => {
    state.proof = summary({ reviews: { counted: 2, truncated: false, repositoriesReviewed: 1, byStatus: { checks_passed: 1, some_new_status: 1 } } });
    render(<Proof />);
    expect(screen.getByText("some_new_status")).toBeTruthy();
  });

  it("reports an empty database as empty instead of inventing an example", () => {
    state.proof = summary({ reviews: { counted: 0, truncated: false, repositoriesReviewed: 0, byStatus: {} }, findings: { counted: 0, truncated: false } });
    render(<Proof />);
    expect(screen.getByText("No reviews recorded in this deployment")).toBeTruthy();
    expect(screen.queryByText("Pull requests reviewed")).toBeNull();
    expect(document.body.textContent).not.toContain("$");
  });

  it("says so when the bound is in effect rather than passing a window off as a total", () => {
    state.proof = summary({ reviews: { ...summary().reviews, counted: 2_000, truncated: true } });
    render(<Proof />);
    expect(screen.getByText("Most recent 2,000")).toBeTruthy();
    expect(document.body.textContent).toContain("a recent window rather than all time");
  });

  // The root boundary answers "We could not load this workspace… Check setup", which is addressed
  // to a signed-in customer. A stranger on the only public route that reads live data has no
  // workspace and no setup, so the failure has to be explained in their terms.
  it("fails in front of a stranger without telling them to check a workspace they do not have", async () => {
    const { default: ProofError } = await import("./error");
    render(<ProofError error={new Error("query unavailable")} reset={() => {}} />);
    expect(screen.getByText("The live numbers did not load")).toBeTruthy();
    for (const wrong of ["workspace", "setup", "authorized request"]) {
      expect(document.body.textContent?.toLowerCase(), wrong).not.toContain(wrong);
    }
    // And it must not paper over the gap with a number of its own.
    expect(document.body.textContent).not.toMatch(/\b\d+\b/);
  });
});

// The page cannot render what the query does not send, so the privacy guarantee is a property of
// convex/publicProof.ts. Comments are stripped first: the file names the excluded fields on purpose
// to explain why each is missing, and a grep that matched the explanation would pass forever.
describe("what the query is allowed to return", () => {
  const source = readFileSync(join(import.meta.dirname, "../../../../../convex/publicProof.ts"), "utf8");
  const whole = source.split("\n").filter(line => !line.trim().startsWith("//")).join("\n");
  // Sliced per query, not per file. summary must name no repository at all; recentPublicReviews
  // exists to name a handful, under a much narrower rule, and asserting the two together would
  // either weaken summary's guarantee or make the second query impossible to write.
  const listStart = whole.indexOf("export const recentPublicReviews");
  const code = whole.slice(0, listStart);
  const listCode = whole.slice(listStart);
  const returned = code.slice(code.indexOf("return {"));

  it("is callable with no identity, and declared that way", () => {
    expect(publicFunctionPolicies["publicProof:summary"]).toEqual({ authorization: "public_webhook", response: "metadata" });
    // The declaration would be a lie if the handler asked for a caller.
    expect(code).not.toMatch(/require\w*Role|getAuthUserId|ctx\.auth/);
  });

  it("returns no tenant, repository, actor or source identifier", () => {
    for (const field of ["organizationId", "repositoryId", "reviewId", "owner", "slug", "githubLogin", "triggerActor", "headSha", "baseSha", "pathHmac", "fingerprintHmac", "contentArtifactId", "currency"]) {
      expect(returned, `${field} must not reach the response`).not.toContain(field);
    }
  });

  it("bounds every read, because it feeds a live subscription", () => {
    expect(whole).not.toContain(".collect()");
    expect([...code.matchAll(/\.take\(rowCeiling\)/g)]).toHaveLength(3);
    // The list query subscribes the same way and has to be bounded the same way.
    expect([...listCode.matchAll(/\.take\(rowCeiling\)/g)]).toHaveLength(2);
  });
});

// This one is allowed to name a repository, which makes the rule it obeys the thing worth pinning.
describe("what the pull request list is allowed to name", () => {
  const source = readFileSync(join(import.meta.dirname, "../../../../../convex/publicProof.ts"), "utf8");
  const whole = source.split("\n").filter(line => !line.trim().startsWith("//")).join("\n");
  const listCode = whole.slice(whole.indexOf("export const recentPublicReviews"));

  it("is callable with no identity, and declared that way", () => {
    expect(publicFunctionPolicies["publicProof:recentPublicReviews"]).toEqual({ authorization: "public_webhook", response: "metadata" });
    expect(listCode).not.toMatch(/require\w*Role|getAuthUserId|ctx\.auth/);
  });

  it("names a repository only when it is public AND an account BuildIT publishes evidence from", () => {
    // Both halves matter. Public alone would put a customer's open-source repository on this page
    // because someone noticed it was world-readable, which is a disclosure they never agreed to.
    expect(listCode).toContain('visibility === "public"');
    expect(listCode).toContain("evidenceOwners.has(item.owner)");
  });

  it("returns nothing derived from source, and no tenant or commit identifier", () => {
    const returned = listCode.slice(listCode.indexOf("return {"));
    for (const field of ["organizationId", "headSha", "baseSha", "pathHmac", "fingerprint", "triggerActor", "ruleId", "githubLogin"]) {
      expect(returned, `${field} must not reach the response`).not.toContain(field);
    }
  });

  it("reports one row per pull request, so a re-reviewed pull request cannot inflate the list", () => {
    expect(listCode).toContain("latest.set(key, review)");
    expect(listCode).toContain("`${review.repositoryId}:${review.prNumber}`");
  });
});

describe("the /proof route", () => {
  it("is one of the routes a stranger can be on", () => {
    expect(isPublicRoute("/proof")).toBe(true);
    expect((publicRoutes as readonly string[])).toContain("/proof");
  });

  // The Edge proxy answers a real 404 for any path route-map does not recognise, which is how the
  // social card shipped 404ing while the page that referenced it built cleanly.
  it("gets past the Edge proxy", () => {
    expect(known("/proof")).toBe(true);
    for (const path of publicRoutes) expect(known(path), path).toBe(true);
  });
});


// The page used to promise "counts and nothing else" and "no repository is identifiable". The pull
// request list makes both false, and a proof page that overstates its own privacy is precisely the
// defect this page exists to prevent. These pin the corrected claim.
describe("what the page claims about itself", () => {
  const page = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");

  it("no longer claims the page returns counts and nothing else", () => {
    expect(page).not.toContain("returns counts and nothing else");
    expect(page).not.toContain("No repository, organization, person or finding is identifiable");
  });

  it("says whose repositories are named, and that a customer's never is", () => {
    expect(page).toContain("No customer&rsquo;s repository, organization,");
    expect(page).toContain("world-readable does not make the commercial relationship public");
  });
});
