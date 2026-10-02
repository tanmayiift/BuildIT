import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Colour was tokenised from the start. Spacing, radius, shadow, type and motion were not, which is
// how the stylesheet came to carry 28 distinct padding values and 9 distinct radii for what are
// really four or five decisions. These assertions are what make the scales a contract rather than a
// suggestion: a scale nothing enforces grows a tenth value the first time somebody is in a hurry.
const files = ["globals.css", "flows.css", "mobile.css"].map(name => `apps/web/src/app/${name}`);
const css = files.map(path => readFileSync(path, "utf8")).join("\n");
const tokens = new Map([...css.matchAll(/--([a-z][a-z0-9-]*):\s*([^;]+);/g)].map(match => [match[1]!, match[2]!.trim()]));

describe("the design token system", () => {
  it("defines one complete scale per decision, not a handful of ad-hoc steps", () => {
    const expected: Record<string, string[]> = {
      space: ["space-1", "space-2", "space-3", "space-4", "space-5", "space-6", "space-7", "space-8", "space-9"],
      radius: ["radius-sm", "radius-md", "radius-lg", "radius-pill"],
      shadow: ["shadow-1", "shadow-2", "shadow-3"],
      type: ["text-2xs", "text-xs", "text-sm", "text-base", "text-md", "text-lg", "text-xl", "text-2xl", "text-figure", "text-3xl", "text-4xl"],
      weight: ["weight-regular", "weight-medium", "weight-semibold", "weight-bold"],
      motion: ["duration-fast", "duration-base", "ease-out"],
    };
    for (const [scale, names] of Object.entries(expected)) {
      for (const name of names) expect(tokens.get(name), `--${name} is missing from the ${scale} scale`).toBeTruthy();
    }
  });

  // The scales are consumed now, so a rule may not step off them. Fluid headings keep clamp(), circles
  // keep 50%, and a corner that is deliberately square keeps 0.
  it("sizes type and rounds corners only from the scales", () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/:root\s*\{[^}]*\}/g, "");
    const fontSizes = [...rules.matchAll(/font-size:\s*([^;}]+)/g)].map(match => match[1]!.trim()).filter(value => !/^(var\(--text-|clamp\()/.test(value));
    const fontShorthand = [...rules.matchAll(/font:\s*\d+\s+([^\s/]+)/g)].map(match => match[1]!).filter(value => !value.startsWith("var(--text-"));
    const radii = [...rules.matchAll(/border-radius:\s*([^;}]+)/g)].flatMap(match => match[1]!.trim().split(/\s+/)).filter(value => !/^(var\(--radius-[a-z]+\)|0|50%)$/.test(value));
    expect({ fontSizes, fontShorthand, radii }).toEqual({ fontSizes: [], fontShorthand: [], radii: [] });
  });

  // Spacing is consumed now too. Hairlines under 4px, em/vh (relative to text or viewport), auto,
  // percentages and 0 are not steps on a spacing scale and stay literal.
  it("spaces margins, padding and gaps only from the scale", () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/:root\s*\{[^}]*\}/g, "");
    const values = [...rules.matchAll(/(?<![\w-])(?:(?:margin|padding)(?:-[a-z]+)*|gap|row-gap|column-gap):\s*([^;}]+)/g)]
      .flatMap(match => match[1]!.trim().split(/\s+(?![^(]*\))/));
    const offScale = values.filter(value => {
      if (/^(0|auto|-?[\d.]+(em|vh|vw|%)|calc\(-1 \* var\(--space-\d\)\)|var\(--space-\d\))$/.test(value)) return false;
      const pixels = /^-?([\d.]+)(px|rem)$/.exec(value);
      return !pixels || Number(pixels[1]) * (pixels[2] === "rem" ? 16 : 1) >= 4;
    });
    expect(offScale).toEqual([]);
  });

  it("keeps the space scale on a 4px base, so a value cannot drift off it", () => {
    for (const step of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const value = tokens.get(`space-${step}`)!;
      const pixels = Number.parseInt(value, 10);
      expect(value, `--space-${step} must be a px value`).toMatch(/^\d+px$/);
      expect(pixels % 4, `--space-${step} is ${value}, which is not a multiple of 4`).toBe(0);
    }
  });

  it("keeps --control-height at the 44px the accessibility contract asserts", () => {
    // interface-accessibility.test.ts asserts the literal 44px inside the .button rule, so
    // that rule keeps its literal. This token is for every other control, and the two must agree or
    // the scale quietly contradicts the gate.
    expect(tokens.get("control-height")).toBe("44px");
    expect(css).toMatch(/\.button\s*\{[^}]*min-height:\s*44px/s);
  });

  it("names a token for every colour the sheet would otherwise hardcode as rgba", () => {
    // Shadows and the mobile drawer overlay were rgba literals repeated across files, which is why a
    // shadow could not be adjusted in one place.
    for (const name of ["overlay", "shadow-1", "shadow-2", "shadow-3", "ink-inverse", "line-subtle", "focus"]) {
      expect(tokens.get(name), `--${name} is missing`).toBeTruthy();
    }
  });

  it("declares the scales in globals.css, which is where the contract is read from", () => {
    // interface-accessibility.test.ts reads exactly these three files. A fourth stylesheet would be
    // invisible to it, so a token defined there would satisfy nothing.
    const globals = readFileSync("apps/web/src/app/globals.css", "utf8");
    for (const name of ["space-4", "radius-md", "text-base", "duration-base", "control-height"]) {
      expect(globals, `--${name} must live in globals.css to be covered by the contract`).toContain(`--${name}:`);
    }
    expect(files).toHaveLength(3);
  });
});

// mobile.css carries two breakpoints and a drawer that only works at the real device width, and the
// app declared no viewport at all - Next's default was carrying it, outside the app's control. The
// only viewport meta in the tree was in proxy.ts's static 404 document.
describe("the responsive contract", () => {
  it("declares a device-width viewport from the root layout", () => {
    const layout = readFileSync("apps/web/src/app/layout.tsx", "utf8");
    expect(layout).toMatch(/export const viewport\s*=/);
    expect(layout).toMatch(/width:\s*"device-width"/);
  });

  it("never disables pinch zoom, which is how a diff gets read on a phone", () => {
    const layout = readFileSync("apps/web/src/app/layout.tsx", "utf8");
    expect(layout).not.toMatch(/userScalable:\s*false/);
    expect(layout).not.toMatch(/maximumScale/);
  });
});
