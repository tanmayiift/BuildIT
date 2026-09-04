import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// BuildIT shipped with no way for anyone to reach anyone: no contact page, no address, no channel.
// A customer whose review failed for a reason the receipt did not explain had nowhere to go, and
// that was one of the open items against a public launch.
//
// The answer is deliberately not a contact page. An unstaffed support address is a worse promise
// than an honest one, so the footer points at the person who builds it. This pins that it stays in
// the footer and does not creep into the top navigation, where it would read as a product link.
const shell = readFileSync(join(import.meta.dirname, "public-shell.tsx"), "utf8");

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
