import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Comments are stripped before anything is parsed. A comment explaining why a dark block is not
// here yet would otherwise be read as one, and the scheme split would measure a palette that does
// not exist - the same class of mistake as a grep matching its own explanation.
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");
const css = stripComments(["globals.css", "flows.css", "mobile.css"]
  .map(name => readFileSync(`apps/web/src/app/${name}`, "utf8")).join("\n"));
const rgb = (hex: string) => [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
const luminance = (hex: string) => rgb(hex).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index]!, 0);
const contrast = (foreground: string, background: string) => { const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a); return (values[0]! + .05) / (values[1]! + .05); };

describe("B2B interface accessibility contract", () => {
  // These ratios used to be computed over hex literals written in this file, so the test agreed
  // with itself: changing a colour in globals.css could not fail it, and a token that no longer
  // existed would still pass. The values are read from the stylesheet now.
  // Built per colour scheme, not once over the whole sheet. A single Map takes the LAST definition
  // of each token, so the moment a @media (prefers-color-scheme: dark) block redefines --canvas, all
  // ten contrast pairs below would silently start measuring the dark palette and stop checking light
  // altogether - a green test verifying half of what it used to. Splitting on the media boundary
  // means both schemes are measured, and a dark palette that fails AA fails here.
  const darkBoundary = /@media\s*\(prefers-color-scheme:\s*dark\)/;
  const [lightSource, ...darkParts] = css.split(darkBoundary);
  const collect = (source: string) => new Map(
    [...source.matchAll(/--([a-z][a-z0-9-]*):\s*(#[0-9a-fA-F]{6})\b/g)].map(match => [match[1]!, match[2]!.toLowerCase()]),
  );
  const tokens = collect(lightSource!);
  // A dark block inherits every token the light palette set and overrides some, so the dark map is
  // the light one with the overrides applied - exactly how the browser resolves it.
  const darkTokens = new Map([...tokens, ...collect(darkParts.join("\n"))]);
  const schemes: Array<[string, Map<string, string>]> = darkParts.length
    ? [["light", tokens], ["dark", darkTokens]]
    : [["light", tokens]];

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
      // The pairs the components actually draw, added with dark mode so both schemes are held to them:
      // text on the navy panels and buttons, links on every ground, and each state's ink on its tint.
      ["ink-inverse", "navy"], ["ink-inverse-muted", "navy"], ["ink-inverse", "navy-hover"],
      ["panel-ink", "panel"], ["panel-ink-2", "panel"], ["panel-ink-muted", "panel"],
      ["navy", "canvas"], ["navy", "surface"], ["navy", "navy-soft"], ["ink-2", "surface"], ["muted", "surface"], ["muted", "workbench"],
      ["danger", "danger-bg"], ["success", "success-bg"], ["warning", "warning-bg"], ["info", "info-bg"],
      ["warning-ink", "warning-strong"], ["success-ink", "success-bright"], ["ink", "hover"],
    ];
    for (const [scheme, map] of schemes) {
      for (const [foreground, background] of pairs) {
        const fore = map.get(foreground)!, back = map.get(background)!;
        expect(fore, `--${foreground} is undefined in the ${scheme} scheme`).toMatch(/^#[0-9a-f]{6}$/);
        expect(back, `--${background} is undefined in the ${scheme} scheme`).toMatch(/^#[0-9a-f]{6}$/);
        expect(contrast(fore, back), `${scheme}: --${foreground} on --${background} (${fore} on ${back})`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("measures every scheme the stylesheet defines, so adding one cannot go unchecked", () => {
    // If a dark block exists, both maps must be present and must actually differ - a dark palette
    // that is a copy of the light one is not dark mode, it is an untested claim to support it.
    const hasDark = darkBoundary.test(css);
    expect(schemes.map(([name]) => name)).toEqual(hasDark ? ["light", "dark"] : ["light"]);
    if (hasDark) {
      expect(darkTokens.get("canvas"), "a dark scheme must redefine --canvas").not.toBe(tokens.get("canvas"));
    }
  });
  it("pins the font roles, control size, focus and reduced-motion boundaries", () => {
    // The faces are tokens now; the roles are pinned on both the token and the rules that use it.
    expect(css).toMatch(/--font-sans:\s*"Manrope Variable"/);
    expect(css).toMatch(/--font-mono:\s*"JetBrains Mono Variable"/);
    expect(css).toMatch(/:root\s*\{[^}]*font-family:\s*var\(--font-sans\)/s);
    expect(css).toMatch(/code, \.mono, time\s*\{[^}]*font-family:\s*var\(--font-mono\)/s);
    expect(css).toMatch(/\.button\s*\{[^}]*min-height:\s*44px/s);
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:/s);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(css).not.toMatch(/transition:\s*all\b/);
  });
});
