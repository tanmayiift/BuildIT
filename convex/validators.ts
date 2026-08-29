import { v } from "convex/values";

export const role = v.union(
  v.literal("owner"), v.literal("admin"), v.literal("developer"), v.literal("viewer"),
);
export const membershipStatus = v.union(v.literal("active"), v.literal("invited"), v.literal("removed"));
export const reviewStatus = v.union(
  v.literal("queued"), v.literal("gathering_context"), v.literal("analyzing"),
  v.literal("validating"), v.literal("checks_passed"), v.literal("changes_requested"),
  v.literal("inconclusive"), v.literal("autofix_queued"), v.literal("autofixing"),
  v.literal("validating_round"), v.literal("validating_final"), v.literal("delivered"),
  v.literal("failed_after_bounds"), v.literal("blocked"), v.literal("cancelling"),
  v.literal("cancelled"), v.literal("budget_exhausted"), v.literal("platform_failed"),
);
export const reviewMode = v.union(v.literal("review"), v.literal("autofix"));
export const triggerSource = v.union(
  v.literal("github_comment"), v.literal("dashboard"), v.literal("automatic"), v.literal("cli"),
);
export const triggerVerb = v.union(
  v.literal("review"), v.literal("autofix"), v.literal("cancel"),
  v.literal("status"), v.literal("help"),
);
export const actorPermission = v.union(
  v.literal("none"), v.literal("read"), v.literal("triage"),
  v.literal("write"), v.literal("maintain"), v.literal("admin"),
);
export const requiredCheckPolicy = v.union(
  v.literal("advisory"), v.literal("fail_open"), v.literal("fail_closed"),
);
export const githubConclusion = v.union(
  v.literal("success"), v.literal("failure"), v.literal("neutral"), v.literal("action_required"),
);
export const terminationBound = v.union(
  v.literal("round_limit"), v.literal("attempt_limit"),
  v.literal("wall_clock_limit"), v.literal("repeated_patch"),
);
export const checkKind = v.union(
  v.literal("test"), v.literal("lint"), v.literal("typecheck"), v.literal("build"),
  v.literal("static_analysis"), v.literal("dependency_audit"),
  v.literal("secret_scan"), v.literal("custom"),
);
export const checkConclusion = v.union(
  v.literal("passed"), v.literal("failed"), v.literal("not_run"),
  v.literal("timed_out"), v.literal("truncated"), v.literal("flaky"),
);
export const failureClass = v.union(
  v.literal("code"), v.literal("environment"), v.literal("tooling_missing"),
  v.literal("timeout"), v.literal("resource_limit"),
  v.literal("network_blocked"), v.literal("platform"),
);
export const artifactType = v.union(
  v.literal("configuration"), v.literal("requirement_content"),
  v.literal("finding_content"), v.literal("evidence_excerpt"),
  v.literal("review_message"), v.literal("command_output"),
  v.literal("scanner_output"), v.literal("patch"), v.literal("base_result"),
  v.literal("prompt_trace"), v.literal("evaluation_report"),
);
export const eventType = v.union(
  v.literal("review_created"), v.literal("stage_started"), v.literal("stage_completed"),
  v.literal("status_changed"), v.literal("head_became_stale"),
  v.literal("credential_teardown_proved"), v.literal("check_recorded"),
  v.literal("finding_recorded"), v.literal("autofix_attempted"),
  v.literal("autofix_round_completed"), v.literal("delivery_recorded"),
  v.literal("cancel_requested"), v.literal("artifact_deleted"),
);
