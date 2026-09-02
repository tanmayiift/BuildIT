import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");
const spec = read("tests/e2e-production/two-user-isolation.spec.ts");
const connections = read("apps/web/src/app/live-connections.tsx");
const styles = read("apps/web/src/app/globals.css");

describe("two-user isolation proof asserts text the app actually renders", () => {
  // The spec asserted "CONNECTED", which appears nowhere in the application source: the banner
  // label is "Connected" and .preview-label uppercases it in CSS. Playwright's toContainText
  // reads textContent, not innerText, so that assertion could never pass and the isolation
  // proof would have failed for a reason unrelated to isolation.
  it("asserts the banner label as it exists in the DOM, not as CSS renders it", () => {
    expect(spec).toContain('toContainText("Connected")');
    expect(spec).not.toContain('toContainText("CONNECTED")');
    expect(connections).toContain('"Connected"');
  });

  it("confirms the label really is uppercased by CSS, so the DOM string is the lowercase one", () => {
    expect(styles).toMatch(/\.preview-label\s*\{[^}]*text-transform:\s*uppercase/);
  });

  // Every literal the spec asserts on must be findable in the app, otherwise the proof is
  // asserting against a string that no longer exists.
  it("every hardcoded literal the spec asserts is present in the web source", () => {
    const literals = [...spec.matchAll(/toContainText\("([^"]+)"\)/g)].map(match => match[1]!);
    expect(literals.length).toBeGreaterThan(0);
    for (const literal of literals) expect(connections).toContain(literal);
  });
});
