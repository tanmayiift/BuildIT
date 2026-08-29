import type { ReviewStatus } from "./review.js";

export type RequiredCheckPolicy = "advisory" | "fail_open" | "fail_closed";
export type GitHubConclusion = "success" | "failure" | "neutral" | "action_required";
const matrix = {
  checks_passed: { advisory: "success", fail_open: "success", fail_closed: "success" },
  changes_requested: { advisory: "failure", fail_open: "failure", fail_closed: "failure" },
  inconclusive: { advisory: "neutral", fail_open: "neutral", fail_closed: "failure" },
  delivered: { advisory: "success", fail_open: "success", fail_closed: "success" },
  failed_after_bounds: { advisory: "failure", fail_open: "failure", fail_closed: "failure" },
  blocked: { advisory: "action_required", fail_open: "action_required", fail_closed: "action_required" },
  budget_exhausted: { advisory: "action_required", fail_open: "action_required", fail_closed: "action_required" },
  cancelled: { advisory: "action_required", fail_open: "action_required", fail_closed: "action_required" },
  platform_failed: { advisory: "neutral", fail_open: "neutral", fail_closed: "failure" },
} as const;
export function githubConclusion(status: ReviewStatus, policy: RequiredCheckPolicy): GitHubConclusion | undefined {
  return status in matrix ? matrix[status as keyof typeof matrix][policy] : undefined;
}
