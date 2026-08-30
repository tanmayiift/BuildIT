import { describe, expect, it } from "vitest";
import { calculateEffectiveLoc, normalizedExecutableLines } from "../src/effectiveLoc.js";

describe("effective LOC", () => {
  it("ignores blank, comment, indentation and formatter-only changes", () => {
    const before = [{ path: "src/value.ts", content: "// note\nexport function value ( ) {\n  return 1 ;\n}\n" }];
    const after = [{ path: "src/value.ts", content: "\n/* changed note */\nexport function value(){\n        return 1;\n}\n" }];
    expect(calculateEffectiveLoc(before, after)).toMatchObject({ added: 0, removed: 0, net: 0 });
  });

  it("counts executable changes but excludes generated, lock, asset and unsupported files", () => {
    const before = [{ path: "src/value.py", content: "# old\ndef value():\n    return 1\n" }, { path: "pnpm-lock.yaml", content: "old" }];
    const after = [{ path: "src/value.py", content: "# new\ndef value():\n    return 2\n" }, { path: "generated/client.ts", content: "export const huge = 1" }, { path: "pnpm-lock.yaml", content: "new" }];
    expect(calculateEffectiveLoc(before, after)).toEqual({ added: 1, removed: 1, net: 0, reverted: 0, eligibleFiles: 1, excludedFiles: 2 });
  });

  it("does not count a pure rename and reports delivered lines later reverted", () => {
    const before = [{ path: "src/old.ts", content: "export const enabled=true;" }];
    const delivered = [{ path: "src/new.ts", content: "export const enabled=true;\nexport const limit=3;" }];
    const later = [{ path: "src/new.ts", content: "export const enabled=true;" }];
    expect(calculateEffectiveLoc(before, delivered, later)).toMatchObject({ added: 1, removed: 0, net: 1, reverted: 1 });
  });

  it("keeps comment markers inside strings", () => {
    expect(normalizedExecutableLines({ path: "src/url.ts", content: 'const url = "https://example.test/#ok"; // note' })).toEqual(['const url="https://example.test/#ok";']);
  });
});
