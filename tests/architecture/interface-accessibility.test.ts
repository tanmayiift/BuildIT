import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("apps/web/src/app/globals.css", "utf8") + readFileSync("apps/web/src/app/flows.css", "utf8") + readFileSync("apps/web/src/app/mobile.css", "utf8");
const rgb = (hex: string) => [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
const luminance = (hex: string) => rgb(hex).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index]!, 0);
const contrast = (foreground: string, background: string) => { const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a); return (values[0]! + .05) / (values[1]! + .05); };

describe("B2B interface accessibility contract", () => {
  // These ratios used to be computed over hex literals written in this file, so the test agreed
  // with itself: changing a colour in globals.css could not fail it, and a token that no longer
  // existed would still pass. The values are read from the stylesheet now.
  const tokens = new Map(
    [...css.matchAll(/--([a-z][a-z0-9-]*):\s*(#[0-9a-fA-F]{6})\b/g)].map(match => [match[1]!, match[2]!.toLowerCase()]),
  );

  it("defines every colour token the contract depends on", () => {
    for (const name of ["canvas", "workbench", "surface", "surface-inset", "ink", "muted", "faint", "navy", "danger", "warning", "success"]) {
      expect(tokens.get(name), `--${name} is not defined in the stylesheet`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("keeps production text and action token pairs at WCAG AA contrast", () => {
    const pairs: Array<[string, string]> = [
      ["ink", "canvas"], ["muted", "canvas"], ["muted", "surface-inset"], ["faint", "workbench"],
      ["canvas", "navy"], ["danger", "canvas"], ["success", "canvas"], ["warning", "canvas"],
      ["ink", "workbench"], ["ink", "surface-inset"],
    ];
    for (const [foreground, background] of pairs) {
      const fore = tokens.get(foreground)!, back = tokens.get(background)!;
      expect(contrast(fore, back), `--${foreground} on --${background} (${fore} on ${back})`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("pins the font roles, control size, focus and reduced-motion boundaries", () => {
    expect(css).toMatch(/font-family:\s*"Manrope Variable"/);
    expect(css).toMatch(/code, \.mono, time\s*\{[^}]*"JetBrains Mono Variable"/s);
    expect(css).toMatch(/\.button,.action\s*\{[^}]*min-height:\s*44px/s);
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:/s);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(css).not.toMatch(/transition:\s*all\b/);
  });
});
