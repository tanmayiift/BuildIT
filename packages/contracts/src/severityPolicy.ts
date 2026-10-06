// Which severities stop a merge. One list, read by arbitration (which marks a finding blocking), by
// the report (which tells the reader) and by the evaluation labels (which expect it).
//
// Until 6 Oct 2026 arbitration also blocked on "warning", and no prompt told the model so: a
// style-level warning the critic agreed with stopped a merge exactly as a security defect did.
export const blockingSeverities = ["critical", "high"] as const;
export type BlockingSeverity = typeof blockingSeverities[number];

export function severityBlocks(severity: string): severity is BlockingSeverity {
  return (blockingSeverities as readonly string[]).includes(severity);
}

// Said wherever findings are listed, so a reader can tell a decision from a suggestion without
// knowing the policy.
export const severityPolicySentence = "Only Critical and High findings block a merge; Warning and Info are advisory.";
