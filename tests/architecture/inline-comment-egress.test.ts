import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { safe } from "../../packages/orchestrator/src/report.js";

// One review used to write two different trust levels into the same pull request: the summary comment
// went through safe(), and the inline comments on the very same findings posted raw model prose.
// Both are model output summarising repository content an outside contributor can influence, and both
// are posted under BuildIT's verified App identity - so an unescaped markdown link in the inline one
// is a usable phishing surface, not a cosmetic bug.
//
// The mapping that builds an inline comment lives inside a Convex action and cannot be called on its
// own, so the hardening is pinned here textually, and its behaviour is proved against safe() itself.
const worker = readFileSync(fileURLToPath(new URL("../../convex/reviewPublicationWorker.ts", import.meta.url)), "utf8");
const writer = readFileSync(fileURLToPath(new URL("../../packages/github/src/repository-writer.ts", import.meta.url)), "utf8");

describe("what reaches an inline pull request comment", () => {
  it("passes every prose field through safe(), and the path through none of it", () => {
    expect(worker).toContain('safe(String(item.title ?? "Finding"))');
    expect(worker).toMatch(/\.map\(text => safe\(String\(text\)\)\)/);
    // The path must stay literal or the comment anchors nowhere; the writer validates it instead.
    expect(worker).not.toMatch(/safe\(String\(item\.path/);
    expect(writer).toMatch(/\/\^\[\\w\.\/-\]\{1,500\}\$\/\.test\(finding\.path\)/);
  });

  it("neutralises the three things that make a bot comment dangerous", () => {
    const hostile = "[Re-run CI](https://attacker.example) — ping @maintainer <img src=x>";
    const result = safe(hostile);
    expect(result, "markdown link punctuation must be escaped").toContain("\\[Re-run CI\\]");
    expect(result).toContain("\\(https://attacker.example\\)");
    expect(result, "a mention must not notify anybody").toContain("＠maintainer");
    expect(result, "@ must not survive as itself").not.toMatch(/(^|[^＠])@/);
    expect(result, "tags must be stripped").not.toContain("<img");
  });

  it("redacts a secret-shaped value rather than quoting it back into the pull request", () => {
    // Assembled from parts: a literal here would be a real finding for gitleaks and would be
    // refused by GitHub push protection before it could ever run.
    const shaped = ["ghp", "_", "A".repeat(36)].join("");
    const result = safe(`found ${shaped} in the diff`);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain(shaped);
  });

  it("keeps control characters and collapsed whitespace out of the body", () => {
    expect(safe("a\u0007b")).toBe("a b");
    expect(safe("  lots   of\n\nspace  ")).toBe("lots of space");
  });
});
