import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// There were two button systems (.button and ActionLink's .action-*) and three Metric
// implementations, each drifting from the others. Collapsing them only holds if a second one cannot
// quietly come back, so this names the one place each lives.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(tsx|css)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}
const sources = files("apps/web/src").map(path => [path, readFileSync(path, "utf8")] as const);

describe("one component for each job", () => {
  it("has one button system", () => {
    // A class named action or action-<variant>, as a whole class: next-action and .actions are other things.
    const asClass = /(?<![\w-])action(?:-(?:primary|secondary|tertiary|compact|default|external))?(?![\w-])/;
    const offenders = sources.filter(([path, code]) => path.endsWith(".css")
      ? /(?<![\w-])\.action(?:-[a-z]+)?(?![\w-])/.test(code.replace(/\/\*[\s\S]*?\*\//g, ""))
      : [...code.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].some(match => asClass.test(match[1] ?? match[2] ?? ""))).map(([path]) => path);
    expect(offenders).toEqual([]);
    // ActionLink builds its class list rather than writing it, so it is pinned directly.
    expect(readFileSync("apps/web/src/app/action.tsx", "utf8")).toMatch(/const classes=\["button",/);
  });

  it("has one Metric, in metric.tsx", () => {
    const definitions = sources.filter(([, code]) => /function Metric\b/.test(code)).map(([path]) => path);
    expect(definitions).toEqual(["apps/web/src/app/metric.tsx"]);
    const handWritten = sources.filter(([path, code]) => path.endsWith(".tsx") && !path.endsWith("metric.tsx") && /className="metric"/.test(code)).map(([path]) => path);
    expect(handWritten).toEqual([]);
  });
});
