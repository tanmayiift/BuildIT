// runtimeReadiness:current used to AND BuildIT's deliberate execution safety switch with a check
// that this deployment holds its own eight review-runtime secrets, and every screen read the one
// boolean that came out. So a secret of ours that was rotated and never re-set was reported to the
// customer as "Repository execution and AI review remain disabled until their safety gates pass" -
// their repository, blamed for our misconfiguration - and the sentence that told the truth could
// never render, because the same boolean disabled the only control that would have thrown it.
//
// The query returns the two facts separately now, and this is the single place that turns them
// into the one word a screen needs.
export type RuntimeReadiness = { executionEnabled: boolean; runtimeConfigured: boolean };
export type ExecutionReadiness = "checking" | "ready" | "safety_blocked" | "service_unconfigured";

// The precedence is the server's: requireExecutionEnabled in convex/lib/executionGate.ts throws
// repository_execution_safety_blocked before review_runtime_configuration_missing, so a screen
// naming the safety gate first names the cause a start attempt would actually have reported.
export function executionReadiness(readiness: RuntimeReadiness | undefined): ExecutionReadiness {
  if (readiness === undefined) return "checking";
  if (!readiness.executionEnabled) return "safety_blocked";
  return readiness.runtimeConfigured ? "ready" : "service_unconfigured";
}

// Kept next to the state it belongs to so the four surfaces that report it cannot drift into
// blaming the reader again. The wording is the one dashboard-review-start.tsx already had for
// review_runtime_configuration_missing.
export const serviceUnconfiguredSummary = "BuildIT is missing part of its own review runtime configuration";
export const serviceUnconfiguredDetail = "BuildIT is missing part of its own review runtime configuration, so no review can start. This is a BuildIT service problem, not a setting you can change: nothing in your workspace, your repositories or your model key caused it, and nothing you change there will clear it. Reviews resume without any action from you once we restore it. Tell us if it lasts.";
