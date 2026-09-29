import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// introducedScannerFindings hard-filters head findings to changedPaths, so a path the budget drops
// takes its scanner findings with it. The repair loop pops entries off changedPaths to fit maxBytes,
// and analysisDroppedChangedFile was computed from `changedPaths.length > 0` - which is false once
// the loop has emptied the array.
//
// So a secret the pull request genuinely introduced into a dropped file was excluded from the
// findings and from the coverage gap that would have admitted it, and the review published a clean
// secret-scan verdict for a commit that added a secret.
const source = readFileSync(join(process.cwd(), "convex/reviewAnalysisWorker.ts"), "utf8");

describe("a dropped changed path is always admitted", () => {
  it("counts the drop as it happens rather than inferring it from what survives", () => {
    expect(source, "popping without counting is what made the loss invisible")
      .toMatch(/exclusions\.changedPaths\.pop\(\);\s*increment\("changedFiles"\)/);
  });

  it("reads the counter when deciding whether a changed file was dropped", () => {
    expect(source).toMatch(/analysisDroppedChangedFile[\s\S]{0,200}totals\?\.changedFiles/);
  });
});
