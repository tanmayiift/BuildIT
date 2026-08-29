import { z } from "zod";

export const reviewStatus = z.enum(["queued","gathering_context","analyzing","validating","checks_passed","changes_requested","inconclusive","autofix_queued","autofixing","validating_final","delivered","failed_after_bounds","blocked","cancelling","cancelled","budget_exhausted","platform_failed"]);
export type ReviewStatus = z.infer<typeof reviewStatus>;
export const terminalStatuses = new Set<ReviewStatus>(["checks_passed","changes_requested","inconclusive","delivered","failed_after_bounds","cancelled","budget_exhausted","platform_failed"]);
export const terminationBound = z.enum(["round_limit","attempt_limit","wall_clock_limit","repeated_patch"]);
export type TerminationBound = z.infer<typeof terminationBound>;
export const checkOutcome = z.enum(["passed","failed","not_run","timed_out","truncated","flaky"]);
export const reviewRecord = z.object({id:z.string(),organizationId:z.string(),repositoryId:z.string(),prNumber:z.number().int().positive(),headSha:z.string().regex(/^[0-9a-f]{7,40}$/),status:reviewStatus,isStale:z.boolean(),terminationBound:terminationBound.optional(),budgetCeilingId:z.string().optional(),completedRoundCount:z.number().int().min(0).max(3),patchAttemptCount:z.number().int().min(0).max(6)}).superRefine((value,ctx)=>{
  if(value.status==="failed_after_bounds"&&!value.terminationBound)ctx.addIssue({code:"custom",message:"failed_after_bounds requires terminationBound"});
  if(value.status==="budget_exhausted"&&!value.budgetCeilingId)ctx.addIssue({code:"custom",message:"budget_exhausted requires budgetCeilingId"});
});
