import type { Infer } from "convex/values";
import type { coverageGap, coverageLevel } from "../validators";

export type CoverageGap = Infer<typeof coverageGap>;
export type CoverageLevel = Infer<typeof coverageLevel>;

// Whether a coverage shortfall is allowed to void the verdict.
//
// Coverage answers several questions at once, and they are not equally serious. If BuildIT could
// not read a file the pull request changed, or the diff itself was truncated, it does not know what
// the change does and must not decide. But a requirement source it could not fetch - an upstream
// ticket in another repository, a tracker with no connected credential - limits only what it can
// say about intent. It can still report that a required check failed, or that a defect exists at a
// cited line, and those are the findings a user came for.
//
// Refusing the whole verdict over an unreadable link made every real pull request inconclusive:
// linking an upstream issue in the description is normal, and BuildIT declines cross-repository
// fetches by design. The limitation is stated in the report instead of erasing the result.
export function blocksVerdict(level: CoverageLevel, gap: CoverageGap | undefined) {
  if (level === "full") return false;
  // An unknown gap fails closed: without a recorded cause there is no way to tell a missing
  // ticket from unread code, and the safe reading is the one that withholds the verdict.
  return gap !== "requirements";
}
