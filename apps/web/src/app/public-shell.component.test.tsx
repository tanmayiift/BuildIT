// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isPublicRoute, publicRoutes } from "./public-routes";

const route = vi.hoisted(() => ({ pathname: "/", search: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.search),
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: false, isLoading: false }),
  useQuery: () => undefined,
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
}));
vi.mock("convex/server", () => ({ makeFunctionReference: (name: string) => name }));
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signOut: vi.fn() }) }));

const { PublicShell } = await import("./public-shell");
const { AppShell } = await import("./app-shell");

// BuildIT shipped with no way for anyone to reach anyone: no contact page, no address, no channel.
// A customer whose review failed for a reason the receipt did not explain had nowhere to go, and
// that was one of the open items against a public launch.
//
// The answer is deliberately not a contact page. An unstaffed support address is a worse promise
// than an honest one, so the footer points at the person who builds it. This pins that it stays in
// the footer and does not creep into the top navigation, where it would read as a product link.
const shell = readFileSync(join(import.meta.dirname, "public-shell.tsx"), "utf8");

afterEach(cleanup);

describe("where a visitor can find the person behind BuildIT", () => {
  const footer = shell.slice(shell.indexOf("<footer"), shell.indexOf("</footer>"));

  it("links to the maintainer from the footer", () => {
    expect(footer).toContain("https://github.com/tanmayiift");
  });

  it("opens it safely, because it leaves the site", () => {
    const link = footer.split("\n").find(line => line.includes("github.com/tanmayiift")) ?? "";
    expect(link).toContain('rel="noreferrer noopener"');
  });

  // The shared `links` array renders both the header nav and the footer nav, so putting it there
  // would silently add it to the top of every page.
  it("stays out of the top navigation", () => {
    const nav = shell.slice(0, shell.indexOf("<footer"));
    expect(nav).not.toContain("github.com/tanmayiift");
  });
});

// A logged-out stranger's first 44px of BuildIT was an amber warning bar reading "Sample evidence
// is clearly marked. Connect GitHub to replace setup examples with your isolated workspace." - copy
// about the sample review tour, rendered above the hero on routes that contain no samples at all.
// It reads as "something is wrong" before one sentence has said what the product does.
const sampleCopy = "Sample evidence is clearly marked";

describe("the marketing shell", () => {
  it("does not warn a stranger about samples that are not on the page", () => {
    const { container } = render(<PublicShell><p>hero</p></PublicShell>);
    expect(container.querySelector(".preview-banner")).toBeNull();
    expect(container.textContent).not.toContain(sampleCopy);
  });

  // The comment in public-shell.tsx names the banner to explain why it left, so this reads the
  // code and not the prose: neither an import of it nor a rendered instance.
  it("does not import the banner at all, so it cannot creep back in as chrome", () => {
    expect(shell).not.toContain("<ConnectionBanner");
    expect(shell.split("\n").filter(line => line.startsWith("import")).join("\n")).not.toContain("ConnectionBanner");
  });

  // Removing it must not cost the marketing routes their own header, footer or way in.
  it("still gives a stranger the brand, the nav and the page itself", () => {
    const { container } = render(<PublicShell><p>hero</p></PublicShell>);
    expect(container.querySelector("header.public-top")).not.toBeNull();
    expect(container.querySelector('a[href="/pricing"]')).not.toBeNull();
    expect(container.querySelector("main.public-main")?.textContent).toBe("hero");
  });

  it("renders every public route through this shell", () => {
    for (const path of publicRoutes) expect(isPublicRoute(path)).toBe(true);
  });
});

// FIXES.md fences the sample-versus-live labelling: "Every sample must still be visibly labelled a
// sample." The guarantee survives because it never lived in the marketing shell. The tour is
// /reviews?tour=1, and /reviews is not a public route - so AppShell takes the workspace branch,
// which still mounts ConnectionBanner, and WorkspaceRouteBoundary stamps its own note on top.
describe("the sample tour keeps its labelling", () => {
  afterEach(() => { route.pathname = "/"; route.search = ""; });

  it("does not route the sample tour through the marketing shell", () => {
    for (const path of ["/reviews", "/reviews/418", "/repositories", "/usage"]) {
      expect(isPublicRoute(path)).toBe(false);
    }
    expect((publicRoutes as readonly string[]).includes("/reviews")).toBe(false);
  });

  it("keeps the banner on the workspace shell the tour renders in", () => {
    route.pathname = "/reviews";
    route.search = "?tour=1";
    const { container } = render(<AppShell><p>queue</p></AppShell>);
    expect(container.querySelector(".public-shell")).toBeNull();
    expect(container.querySelector(".preview-banner")).not.toBeNull();
    expect(container.textContent).toContain(sampleCopy);
  });

  it("labels the tour a sample in the route itself, not only in the banner", () => {
    route.pathname = "/reviews";
    route.search = "?tour=1";
    const { container } = render(<AppShell><p>queue</p></AppShell>);
    expect(container.querySelector(".sample-route-note")?.textContent)
      .toContain("Sample tour · no live workspace data");
  });

  it("keeps the banner on a workspace route that is not the tour", () => {
    route.pathname = "/repositories";
    const { container } = render(<AppShell><p>repos</p></AppShell>);
    expect(container.querySelector(".preview-banner")).not.toBeNull();
  });

  it("gives a marketing route the marketing shell and no banner", () => {
    route.pathname = "/pricing";
    const { container } = render(<AppShell><p>pricing</p></AppShell>);
    expect(container.querySelector(".public-shell")).not.toBeNull();
    expect(container.querySelector(".preview-banner")).toBeNull();
  });
});
