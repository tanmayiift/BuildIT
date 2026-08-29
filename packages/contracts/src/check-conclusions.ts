import type { ReviewStatus } from "./review.js";
export type RequiredCheckPolicy="advisory"|"fail_open"|"fail_closed";
export type GitHubConclusion="success"|"failure"|"neutral"|"action_required";
const success=new Set<ReviewStatus>(["checks_passed","delivered"]);
const codeFailure=new Set<ReviewStatus>(["changes_requested","failed_after_bounds"]);
const action=new Set<ReviewStatus>(["blocked","cancelled","budget_exhausted"]);
export function githubConclusion(status:ReviewStatus,policy:RequiredCheckPolicy):GitHubConclusion{
  if(success.has(status))return "success";
  if(action.has(status))return "action_required";
  if(codeFailure.has(status))return "failure";
  if(status==="platform_failed")return policy==="fail_closed"?"failure":"neutral";
  return "neutral";
}
