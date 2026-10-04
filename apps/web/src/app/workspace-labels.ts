// Names for the codes the workspace pages show that are not review statuses. Each of these used to
// reach the screen raw: /history printed incompleteReason with its underscores turned into spaces,
// the evaluation queue printed a reasonCode verbatim, and the audit log printed `allowed` as a pill.

/** Why a review stopped short of a verdict. Written by reviewValidationData.finalizeDecision. */
export const incompleteReasonLabels: Record<string, string> = {
  conclusion_unusable: "A required check produced no usable result",
  coverage_partial: "Not every changed file could be reviewed",
  evidence_missing: "Required evidence was missing",
  injection_unscoped: "Instruction-like text could not be attributed to a changed file",
  no_required_check: "The repository defines no required check",
  tests_need_lockfile: "The project's tests need a lockfile BuildIT did not find",
  test_suite_failing: "The test suite failed on both commits and too little of it ran",
  uncertain_escalated: "A finding stayed unresolved after two passes",
  unknown: "The reason was not recorded",
};

export function incompleteReasonLabel(reason: string) {
  return incompleteReasonLabels[reason] ?? "The reason was not recorded";
}

/** What an audit event records. The exact action stays visible beside this as an identifier - in an
 *  audit log that string is the forensic key - but it is no longer the only thing a reader gets. */
export const auditActionLabels: Record<string, string> = {
  "review.created": "Review started",
  "review.previewed": "Review previewed",
  "finding.dismissed": "Finding dismissed",
  "credential.rotated": "Model key rotated",
  "credential.revoked": "Model key revoked",
  "credential_validate": "Model key checked",
  "membership.invited": "Member invited",
  "membership.accepted": "Invitation accepted",
  "membership.removed": "Member removed",
  "membership.role_changed": "Member role changed",
  "organization.capacity_changed": "Workspace limits changed",
  "repository.policy_changed": "Repository policy changed",
  "notification.preferences_changed": "Notification preferences changed",
  "tracker.oauth_connected": "Issue tracker connected",
  "tracker.revoked": "Issue tracker disconnected",
  "audit.event.tampered": "Audit record failed its integrity check",
};

export function auditActionLabel(action: string) {
  return auditActionLabels[action] ?? "Recorded action";
}

/** Whether the action was let through. "denied" is a refusal working, not an error. */
export function auditResultLabel(result: string) {
  return result === "allowed" ? "Allowed" : result === "denied" ? "Refused" : "Outcome unrecorded";
}
