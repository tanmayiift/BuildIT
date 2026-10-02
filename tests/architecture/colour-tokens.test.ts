import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Dark mode was written once and withdrawn: the palette passed contrast in both schemes, and then
// 52 literal hex values and 7 white/black fills inside component rules would have kept their light
// values under it - dark text on a dark ground. So a component rule may only name a token, and a
// theme is a change to the token block alone.
const sheets = ["globals.css", "flows.css", "mobile.css"].map(name => [name, readFileSync(`apps/web/src/app/${name}`, "utf8")] as const);
const literal = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|(?<![\w-])(?:white|black)(?![\w-])/;

function componentDeclarations(css: string) {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: Array<{ selector: string; declaration: string }> = [];
  for (const rule of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1]!.trim();
    if (/^:root\b/.test(selector)) continue;
    for (const declaration of rule[2]!.split(";")) if (declaration.trim()) found.push({ selector, declaration: declaration.trim() });
  }
  return found;
}

describe("colour lives in tokens", () => {
  for (const [name, css] of sheets) {
    it(`${name} names no colour outside :root`, () => {
      const offenders = componentDeclarations(css)
        .filter(({ declaration }) => !/^white-space\s*:/.test(declaration) && literal.test(declaration.replace(/^[\w-]+\s*:/, "")))
        .map(({ selector, declaration }) => `${selector.slice(-60)} { ${declaration} }`);
      expect(offenders).toEqual([]);
    });
  }

  it("defines every token a rule names", () => {
    const all = sheets.map(([, css]) => css.replace(/\/\*[\s\S]*?\*\//g, "")).join("\n");
    const defined = new Set([...all.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
    const used = new Set([...all.matchAll(/var\((--[\w-]+)/g)].map(match => match[1]));
    expect([...used].filter(token => !defined.has(token))).toEqual([]);
  });
});
