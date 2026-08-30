import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("evaluation release-gate entrypoint", () => {
  it("points both package and root commands at the emitted CLI", () => {
    const root = JSON.parse(readFileSync("package.json", "utf8"));
    const evaluations = JSON.parse(
      readFileSync("packages/evaluations/package.json", "utf8"),
    );
    expect(root.scripts["eval:gate"]).toContain("dist/src/cli.js");
    expect(evaluations.bin["buildit-eval"]).toBe("dist/src/cli.js");
    expect(existsSync("packages/evaluations/dist/src/cli.js")).toBe(true);
  });
});
