import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// /scan executed code a stranger pasted. It was the only surface in the product running
// attacker-supplied input with no account behind it, so once BuildIT had tenants other than its
// author it was gated off behind a build-time flag - which left the page a closed door and the
// product with no zero-commitment proof of output at all.
//
// It is a read-only proof of one real review now: no form, no execution, no sandbox seconds, no abuse
// surface, and better evidence than a scan of pasted text could ever be. These assertions keep it
// that way, because "add a textarea back to /scan" is a small, reasonable-sounding change.
const root = join(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const page = read("apps/web/src/app/scan/page.tsx");

describe("the scan page is proof, not execution", () => {
  it("renders no control that could submit anything", () => {
    for (const element of ["<form", "<textarea", "<input", "onSubmit", "useState"]) {
      expect(page, `${element} belongs to the executing version of this page`).not.toContain(element);
    }
  });

  it("calls nothing - no fetch, no action, no scanner", () => {
    expect(page).not.toMatch(/fetch\(|use server|@buildit\/scanners/);
  });

  it("cites a real pull request a reader can open", () => {
    // The whole claim of the page is checkability, so the link out is the load-bearing part.
    expect(page).toContain("review.finding.source.href");
    expect(page).toContain("rel=\"noreferrer noopener\"");
  });

  it("quotes only the fields sample-data documents as transcribed from the real review", () => {
    // The row's own repo, commit and title are illustrative placeholders for the queue mock. Quoting
    // those as evidence would be exactly the defect this page exists to avoid.
    expect(page, "the row's illustrative commit must not be cited").not.toMatch(/\{review\.commit\}/);
    expect(page, "the row's illustrative base commit must not be cited").not.toMatch(/\{review\.baseCommit\}/);
    expect(page, "the row's illustrative repo must not be cited").not.toMatch(/\{review\.repo\}/);
    expect(page).toContain("review.finding.commit");
  });

  it("says what it is not, so a single review does not read as a claim about anybody's code", () => {
    expect(page).toMatch(/What this is not/);
  });

  it("leaves no executing route, panel or flag behind", () => {
    for (const path of [
      "apps/web/src/app/api/scan/route.ts",
      "apps/web/src/app/scan-panel.tsx",
      "apps/web/src/app/public-demo-gate.ts",
      "playwright.demo-closed.config.ts",
      "tests/e2e-demo-closed",
    ]) {
      expect(existsSync(join(root, path)), `${path} still exists`).toBe(false);
    }
    const web = readdirSync(join(root, "apps/web/src/app/api"));
    expect(web, "the scan API route directory must be gone").not.toContain("scan");
  });

  it("holds no demo flag anywhere, so there is only one state to test", () => {
    for (const path of ["playwright.config.ts", "package.json", "apps/web/package.json"]) {
      expect(read(path), `${path} still references the demo flag`).not.toContain("BUILDIT_PUBLIC_DEMO");
    }
    expect(read("apps/web/package.json"), "the web app no longer runs scanners").not.toContain("@buildit/scanners");
  });
});
