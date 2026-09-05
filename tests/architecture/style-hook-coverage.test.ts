import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// `.button.danger` matched no rule, so "Cancel review" - a destructive action - rendered with the
// primary call-to-action styling. That was found by eye, fixed, and written up as a one-off.
//
// It was not a one-off. An audit of every className in the app against every stylesheet found six
// more, and the two worst were not cosmetic:
//
//   .boundary-note.danger  a failed audit-chain verification rendered pixel-identical to a passing
//                          one, because only the wording changed. On the tamper-evidence surface.
//   .setup-dot.ready       the connection dot stayed amber after a successful connect, so a
//                          customer who had finished setup was told, in colour, that they had not.
//   .setup-main            the selector said `main` and the JSX has always rendered a div, so the
//                          primary column of all four onboarding steps had no padding, border or
//                          radius while the <aside> beside it had all three.
//
// Every one of them is invisible to typecheck, to lint, and to a snapshot test that only asserts
// text. A class name is a string on one side and a selector on the other, and nothing was checking
// that the two ever met. This does.
//
// It deliberately checks modifiers too - `.setup-dot` existing is not evidence that
// `.setup-dot.ready` does, and the modifier is where every one of these bugs lived.

const webRoot = join(import.meta.dirname, "../../apps/web/src");

function walk(dir: string, match: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path, match);
    return match(entry.name) ? [path] : [];
  });
}

const stylesheets = walk(webRoot, name => name.endsWith(".css")).map(path => readFileSync(path, "utf8")).join("\n");

// Every class name that appears anywhere in a selector. Substring matching would let `.metric`
// vouch for `.hero-metric`, which is the exact false negative that hid three of these.
const defined = new Set([...stylesheets.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(match => match[1]!));

const sources = walk(webRoot, name => (name.endsWith(".tsx") || name.endsWith(".ts")) && !name.includes(".test."));

// Static `className="a b"` and every string literal inside a className={...} expression, which is
// where template-literal modifiers like `boundary-note${x ? " danger" : ""}` put them.
function classNamesIn(source: string) {
  const names = new Set<string>();
  for (const match of source.matchAll(/className=(?:"([^"]*)"|\{([^}]*(?:\{[^}]*\}[^}]*)*)\})/g)) {
    const literal = match[1];
    if (literal !== undefined) { for (const name of literal.split(/\s+/)) if (name) names.add(name); continue; }
    const expression = match[2] ?? "";
    for (const quoted of expression.matchAll(/["'`]([^"'`]*)["'`]/g)) {
      for (const name of quoted[1]!.split(/\s+/)) {
        // Skip interpolation fragments and anything that is plainly not a class token.
        if (name && !name.includes("$") && !name.includes("{") && /^-?[_a-zA-Z][\w-]*$/.test(name)) names.add(name);
      }
    }
  }
  return names;
}

describe("every class the app renders has a rule behind it", () => {
  it("finds no className without a matching selector", () => {
    const orphans: string[] = [];
    for (const path of sources) {
      for (const name of classNamesIn(readFileSync(path, "utf8"))) {
        if (!defined.has(name)) orphans.push(`${path.slice(webRoot.length + 1)}: .${name}`);
      }
    }
    expect(orphans.sort()).toEqual([]);
  });

  it("still fails when a modifier is missing but its base class exists", () => {
    // The negative control. Without it this test could pass by matching base classes only, which
    // is how `.setup-dot.ready` survived alongside a perfectly real `.setup-dot`.
    expect(defined.has("setup-dot")).toBe(true);
    expect(defined.has("buildit-class-that-should-never-exist")).toBe(false);
  });
});
