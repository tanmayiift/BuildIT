// The review verdict, in the one place both runtimes can reach it.
//
// It lived in @buildit/orchestrator, which is Node-only, so convex/reviewValidationData.ts - a
// default-runtime mutation - could not call it and grew its own copy of the ladder instead. Those
// two copies then disagreed on a flaky rerun, on a truncated output, and on a finding the critic
// could not resolve twice, and each disagreement published a GitHub check run that contradicted the
// comment beside it. Moving it here is what makes "derive it once" actually available to the
// caller that was reimplementing it.

export type ReviewCheckDecision={name:string;required:boolean;conclusion:"passed"|"failed"|"not_run"|"not_configured"|"timed_out"|"truncated"|"flaky";evidenceComplete:boolean;preExisting?:boolean;excerpt?:string};
// A required check that reported not_configured is demoted rather than counted as missing evidence.
// "Missing script: test" is a fact about the repository, not a gap in what BuildIT gathered, and
// missing evidence carries nextAction retry_review - so every pull request in a repository with no
// test script got a neutral "Review needs attention", a summary reading "Complete evidence was not
// available", and an instruction to retry that could never once succeed. The evidence was complete;
// there was simply no test command to run.
//
// This mirrors what reportChecks already does for a scanner that could not run, where required is
// set from whether the scanner was actually available.
export function computeReviewDecision(input:{isStale:boolean;environmentAvailable:boolean;coverageComplete?:boolean;injectionUnscoped?:boolean;uncertainEscalated?:boolean;checks:ReviewCheckDecision[];findings:Array<{resolution:"accepted"|"rejected"|"uncertain";blocking:boolean}>}){const required=input.checks.filter(check=>check.required&&check.conclusion!=="not_configured"),notConfigured=input.checks.filter(check=>check.required&&check.conclusion==="not_configured"),missing=required.filter(check=>!["passed","failed"].includes(check.conclusion)||!check.evidenceComplete),failed=required.filter(check=>check.conclusion==="failed"&&check.evidenceComplete&&!check.preExisting),blocking=input.findings.filter(finding=>finding.resolution==="accepted"&&finding.blocking);if(input.isStale)return{status:"inconclusive" as const,reason:"stale_commit" as const,nextAction:"start_new_review" as const};if(!input.environmentAvailable)return{status:"inconclusive" as const,reason:"environment_unavailable" as const,nextAction:"retry_review" as const};if(input.injectionUnscoped)return{status:"inconclusive" as const,reason:"prompt_injection_unscoped" as const,nextAction:"human_merge" as const};if(input.uncertainEscalated)return{status:"inconclusive" as const,reason:"human_review_required" as const,nextAction:"inspect_findings" as const};if(input.coverageComplete===false)return{status:"inconclusive" as const,reason:"incomplete_coverage" as const,nextAction:"retry_review" as const};if(!required.length||missing.length)return{status:"inconclusive" as const,reason:"required_check_missing" as const,nextAction:"retry_review" as const,missingChecks:missing.map(check=>check.name)};if(failed.length||blocking.length)return{status:"changes_requested" as const,reason:failed.length?"required_check_failed" as const:"blocking_findings" as const,nextAction:"inspect_findings" as const};return{status:"checks_passed" as const,reason:"checks_complete" as const,nextAction:"none" as const,...(notConfigured.length?{notConfigured:notConfigured.map(check=>check.name)}:{})}}
