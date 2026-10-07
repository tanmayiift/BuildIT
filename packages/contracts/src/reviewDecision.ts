import type { TestCounts } from "./projectChecks.js";
// The review verdict, in the one place both runtimes can reach it.
//
// It lived in @buildit/orchestrator, which is Node-only, so convex/reviewValidationData.ts - a
// default-runtime mutation - could not call it and grew its own copy of the ladder instead. Those
// two copies then disagreed on a flaky rerun, on a truncated output, and on a finding the critic
// could not resolve twice, and each disagreement published a GitHub check run that contradicted the
// comment beside it. Moving it here is what makes "derive it once" actually available to the
// caller that was reimplementing it.

export type ReviewCheckDecision={name:string;required:boolean;conclusion:"passed"|"failed"|"not_run"|"not_configured"|"timed_out"|"truncated"|"flaky";evidenceComplete:boolean;preExisting?:boolean;excerpt?:string;notRunReason?:"no_lockfile";testSuiteFailing?:true;testCounts?:TestCounts};
// A required check that reported not_configured is demoted rather than counted as missing evidence.
// "Missing script: test" is a fact about the repository, not a gap in what BuildIT gathered, and
// missing evidence carries nextAction retry_review - so every pull request in a repository with no
// test script got a neutral "Review needs attention", a summary reading "Complete evidence was not
// available", and an instruction to retry that could never once succeed. The evidence was complete;
// there was simply no test command to run.
//
// This mirrors what reportChecks already does for a scanner that could not run, where required is
// set from whether the scanner was actually available.
export function computeReviewDecision(input:{isStale:boolean;environmentAvailable:boolean;coverageComplete?:boolean;injectionUnscoped?:boolean;uncertainEscalated?:boolean;checks:ReviewCheckDecision[];findings:Array<{resolution:"accepted"|"rejected"|"uncertain";blocking:boolean;severity?:string}>}){const required=input.checks.filter(check=>check.required&&check.conclusion!=="not_configured"),notConfigured=input.checks.filter(check=>check.required&&check.conclusion==="not_configured"),missing=required.filter(check=>!["passed","failed"].includes(check.conclusion)||!check.evidenceComplete),failed=required.filter(check=>check.conclusion==="failed"&&check.evidenceComplete&&!check.preExisting),blocking=input.findings.filter(finding=>finding.resolution==="accepted"&&finding.blocking);if(input.isStale)return{status:"inconclusive" as const,reason:"stale_commit" as const,nextAction:"start_new_review" as const};if(input.injectionUnscoped)return{status:"inconclusive" as const,reason:"prompt_injection_unscoped" as const,nextAction:"human_merge" as const}
// A confirmed problem decides the review on its own. Missing evidence used to outrank it, so a
// critical or high finding the critic and arbitration both confirmed - or a required check that
// failed - published a neutral "inconclusive" whenever some other check could not run. In a
// repository with no lockfile that was every review: the R1 benchmark's p-queue run reported
// "1 blocking issue" under a next step of "commit a lockfile", and BuildIT's check did not block the
// merge. Only a stale commit or unscoped prompt injection comes first, because those put the
// findings themselves in doubt. What did not run is still reported beside the verdict.
if(failed.length||blocking.length)return{status:"changes_requested" as const,reason:failed.length?"required_check_failed" as const:"blocking_findings" as const,nextAction:"inspect_findings" as const,...(missing.length?{missingChecks:missing.map(check=>check.name)}:{})}
if(!input.environmentAvailable)return{status:"inconclusive" as const,reason:"environment_unavailable" as const,nextAction:"retry_review" as const};if(input.uncertainEscalated)return{status:"inconclusive" as const,reason:"human_review_required" as const,nextAction:"inspect_findings" as const};if(input.coverageComplete===false)return{status:"inconclusive" as const,reason:"incomplete_coverage" as const,nextAction:"retry_review" as const};// A project whose declared tests could not run because it has no lockfile is inconclusive, never a pass
// on the scanners alone - and not "retry", which can never succeed: the remedy is a commit, not a rerun.
if(missing.length&&missing.every(check=>check.notRunReason==="no_lockfile"))return{status:"inconclusive" as const,reason:"tests_need_lockfile" as const,nextAction:"add_lockfile" as const,missingChecks:missing.map(check=>check.name)}
if(!required.length||missing.length)return{status:"inconclusive" as const,reason:"required_check_missing" as const,nextAction:"retry_review" as const,missingChecks:missing.map(check=>check.name)}
// A critical or high finding nobody could confirm or rule out. It cannot block - only an accepted
// finding blocks - so it used to fall through to checks_passed: a green check over a possibly serious
// defect, with the comment beneath it listing the finding. With nothing confirmed to fix, the honest
// badge is "a person decides". Placed after changes_requested, so a confirmed problem still says so.
if(input.findings.some(finding=>finding.resolution==="uncertain"&&(finding.severity==="critical"||finding.severity==="high")))return{status:"inconclusive" as const,reason:"human_review_required" as const,nextAction:"inspect_findings" as const}
// A required test suite that fails on both commits is excused as pre-existing only when it otherwise ran:
// tests passed, and most of its test files did not fail. One that fails entirely, loads only a few of its
// files, or says nothing readable shows nothing about this change, and missing evidence is never a pass.
// The flag is set from the runner's output by testSuiteRanTooLittle.
if(required.some(check=>check.conclusion==="failed"&&check.preExisting&&check.testSuiteFailing))return{status:"inconclusive" as const,reason:"test_suite_failing" as const,nextAction:"repair_test_suite" as const}
return{status:"checks_passed" as const,reason:"checks_complete" as const,nextAction:"none" as const,...(notConfigured.length?{notConfigured:notConfigured.map(check=>check.name)}:{})}}
