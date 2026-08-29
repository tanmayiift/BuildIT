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
export const installationStatus = v.union(v.literal("active"), v.literal("suspended"), v.literal("removed"));
export const accountType = v.union(v.literal("user"), v.literal("organization"));
export const autofixMode = v.union(v.literal("disabled"), v.literal("stacked"), v.literal("direct_push"));
export const forkPolicy = v.union(v.literal("manual_review_only"), v.literal("disabled"));
export const indexState = v.union(v.literal("not_started"), v.literal("building"), v.literal("ready"), v.literal("stale"), v.literal("failed"));
export const provider = v.union(v.literal("anthropic"), v.literal("openai"));
export const credentialStatus = v.union(v.literal("pending_validation"), v.literal("valid"), v.literal("invalid"), v.literal("revoked"));
export const trackerProvider = v.union(v.literal("github"), v.literal("linear"), v.literal("jira"));
export const trackerStatus = v.union(v.literal("active"), v.literal("expired"), v.literal("revoked"), v.literal("invalid_scope"));
export const configValidationState = v.union(v.literal("valid"), v.literal("invalid"));
export const configProvenance = v.union(v.literal("protected_ref_merge"), v.literal("explicit_admin_approval"), v.literal("defaults_only"));
export const refProtectionState = v.union(v.literal("verified"), v.literal("unverified"));
export const coverageLevel = v.union(v.literal("full"), v.literal("partial"), v.literal("limited"));
export const reviewStage = v.union(
  v.literal("queue"), v.literal("context"), v.literal("analysis"), v.literal("validation"),
  v.literal("autofix"), v.literal("final_validation"), v.literal("delivery"), v.literal("complete"),
);
export const redactionStatus = v.union(v.literal("pending"), v.literal("redacted"), v.literal("rejected"));
export const sourceType = v.union(v.literal("pull_request"), v.literal("github_issue"), v.literal("linear"), v.literal("jira"), v.literal("repository_document"), v.literal("test"));
export const requirementStatus = v.union(v.literal("resolved"), v.literal("missing"), v.literal("inaccessible"), v.literal("conflicting"), v.literal("excluded"));
export const severity = v.union(v.literal("critical"), v.literal("high"), v.literal("warning"), v.literal("info"));
export const findingCategory = v.union(v.literal("correctness"), v.literal("security"), v.literal("requirement"), v.literal("architecture"), v.literal("quality"), v.literal("dependency"), v.literal("test"));
export const findingResolution = v.union(v.literal("open"), v.literal("accepted"), v.literal("dismissed"), v.literal("fixed"), v.literal("uncertain"));
export const suppressionScope = v.union(v.literal("commit"), v.literal("pull_request"), v.literal("path"), v.literal("repository"));
export const patchOutcome = v.union(v.literal("applied"), v.literal("rejected"), v.literal("empty"), v.literal("repeated"));
export const validationScope = v.union(v.literal("affected_subset"), v.literal("final_validation"));
export const validationOutcome = v.union(v.literal("passed"), v.literal("failed"), v.literal("incomplete"));
export const usageKind = v.union(v.literal("model_tokens"), v.literal("model_spend"), v.literal("sandbox_seconds"), v.literal("vcpu_minutes"), v.literal("storage_bytes"));
export const sideEffectType = v.union(v.literal("check_create"), v.literal("check_update"), v.literal("comment_create"), v.literal("comment_update"), v.literal("branch_create"), v.literal("commit_push"), v.literal("stacked_pr_create"), v.literal("token_revoke"));
export const sideEffectStatus = v.union(v.literal("reserved"), v.literal("completed"), v.literal("failed"), v.literal("reconciled"));
export const webhookDisposition = v.union(v.literal("processed"), v.literal("ignored_bot"), v.literal("ignored_edit"), v.literal("duplicate"), v.literal("rejected"));
export const webhookStatus = v.union(v.literal("received"), v.literal("enqueued"), v.literal("completed"), v.literal("failed"));
export const notificationChannel = v.union(v.literal("email"), v.literal("dashboard"));
export const notificationStatus = v.union(v.literal("pending"), v.literal("sent"), v.literal("failed"));
export const auditResult = v.union(v.literal("allowed"), v.literal("denied"), v.literal("failed"));
export const statusReasonCode = v.union(
  v.literal("checks_complete"), v.literal("blocking_findings"),
  v.literal("required_check_missing"), v.literal("unsupported_check"),
  v.literal("environment_unavailable"), v.literal("review_timeout"),
  v.literal("final_validation_incomplete"), v.literal("provider_credential_invalid"),
  v.literal("installation_suspended"), v.literal("permission_revoked"),
  v.literal("user_cancelled"), v.literal("blocked_expired"),
  v.literal("spend_ceiling_reached"), v.literal("platform_error"),
  v.literal("delivery_complete"),
);
export const nextActionCode = v.union(
  v.literal("none"), v.literal("inspect_findings"), v.literal("request_autofix"),
  v.literal("retry_review"), v.literal("reconnect_provider"),
  v.literal("restore_installation"), v.literal("grant_permission"),
  v.literal("increase_budget"), v.literal("human_merge"), v.literal("start_new_review"),
);
export const notificationType = v.union(
  v.literal("review_finished"), v.literal("autofix_delivered"),
  v.literal("autofix_failed"), v.literal("budget_warning"),
  v.literal("budget_exhausted"), v.literal("credential_invalid"),
  v.literal("installation_suspended"), v.literal("retention_deletion_failed"),
);
export const metricName = v.union(
  v.literal("review_completed"), v.literal("autofix_applied"),
  v.literal("ci_regression_caught"), v.literal("autofix_first_pass_round"),
  v.literal("review_duration_ms"), v.literal("runner_failure"),
  v.literal("provider_failure"), v.literal("stale_review"),
  v.literal("human_time_to_merge_ms"), v.literal("reconciliation_lag_ms"),
);
