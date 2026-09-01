const HASH = /^[0-9a-f]{64}$/;
const NOTE_FORBIDDEN = /(?:https?:\/\/|www\.|github|@[a-z0-9.-]+|[a-z0-9_.-]+\/[a-z0-9_.-]+|-----BEGIN|\b(?:api[ _-]?key|secret|token|password|commit|repository|repo)\b)/i;
const FEEDBACK = new Set(["clear", "unclear"]);
const TRUST_OUTCOME = new Set(["trusted", "abandoned"]);
const REUSE = new Set(["yes", "no", "unsure"]);
const JOB = new Set(["manual_pr_review", "release_delay", "blind_merge_risk", "other_review_work"]);

type Feedback = "clear" | "unclear";
export type DesignPartnerSession = {
  participantHash: string;
  teamHash: string;
  observerHash: string;
  observedAt: number;
  activation: {
    landing: boolean;
    permissionReceipt: boolean;
    repositorySelection: boolean;
    exactScopePreview: boolean;
    firstEvidenceResult: boolean;
  };
  firstEvidenceMs: number | null;
  founderIntervened: boolean;
  ahaMomentReached: boolean;
  trustBoundaryUnderstood: boolean;
  trustOutcome: "trusted" | "abandoned";
  trustNote: string;
  feedback: {
    copy: Feedback;
    contrast: Feedback;
    fontSize: Feedback;
    primaryAction: Feedback;
    guidance: Feedback;
  };
  exactJob: "manual_pr_review" | "release_delay" | "blind_merge_risk" | "other_review_work";
  wouldUseAgain: "yes" | "no" | "unsure";
  repeatReviewCompleted: boolean;
};

export type DesignPartnerEvidence = {
  version: string;
  niche: string;
  startedAt: number;
  endedAt: number;
  securityIncidentCount: number;
  fourLineStatement: {
    whatBuilt: string;
    whoFor: string;
    whyCare: string;
    link: string;
  };
  sessions: DesignPartnerSession[];
};

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const safeText = (value: unknown, maximum: number) => typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !NOTE_FORBIDDEN.test(value);

export function parseDesignPartnerEvidence(value: unknown): DesignPartnerEvidence {
  if (!object(value) || !exactKeys(value, ["version", "niche", "startedAt", "endedAt", "securityIncidentCount", "fourLineStatement", "sessions"])) throw new Error("design_partner_evidence_invalid");
  const incidentCount = value.securityIncidentCount;
  if (typeof value.version !== "string" || !safeText(value.niche, 120) || typeof value.startedAt !== "number" || typeof value.endedAt !== "number" || typeof incidentCount !== "number" || !Number.isSafeInteger(incidentCount) || incidentCount < 0 || !object(value.fourLineStatement) || !Array.isArray(value.sessions)) throw new Error("design_partner_evidence_invalid");
  const statement = value.fourLineStatement;
  if (!exactKeys(statement, ["whatBuilt", "whoFor", "whyCare", "link"]) || !safeText(statement.whatBuilt, 180) || !safeText(statement.whoFor, 180) || !safeText(statement.whyCare, 180) || typeof statement.link !== "string" || statement.link !== "https://buildit-agentic-review.vercel.app") throw new Error("design_partner_statement_invalid");
  for (const row of value.sessions) {
    if (!object(row) || !exactKeys(row, ["participantHash", "teamHash", "observerHash", "observedAt", "activation", "firstEvidenceMs", "founderIntervened", "ahaMomentReached", "trustBoundaryUnderstood", "trustOutcome", "trustNote", "feedback", "exactJob", "wouldUseAgain", "repeatReviewCompleted"])) throw new Error("design_partner_session_invalid");
    if (!HASH.test(String(row.participantHash)) || !HASH.test(String(row.teamHash)) || !HASH.test(String(row.observerHash)) || typeof row.observedAt !== "number" || typeof row.founderIntervened !== "boolean" || typeof row.ahaMomentReached !== "boolean" || typeof row.trustBoundaryUnderstood !== "boolean" || !TRUST_OUTCOME.has(String(row.trustOutcome)) || !safeText(row.trustNote, 280) || !JOB.has(String(row.exactJob)) || !REUSE.has(String(row.wouldUseAgain)) || typeof row.repeatReviewCompleted !== "boolean") throw new Error("design_partner_session_invalid");
    const firstEvidenceMs = row.firstEvidenceMs;
    if (firstEvidenceMs !== null && (typeof firstEvidenceMs !== "number" || !Number.isSafeInteger(firstEvidenceMs) || firstEvidenceMs < 0 || firstEvidenceMs > 86_400_000)) throw new Error("design_partner_timing_invalid");
    if (!object(row.activation) || !exactKeys(row.activation, ["landing", "permissionReceipt", "repositorySelection", "exactScopePreview", "firstEvidenceResult"]) || Object.values(row.activation).some(stage => typeof stage !== "boolean")) throw new Error("design_partner_activation_invalid");
    if (!object(row.feedback) || !exactKeys(row.feedback, ["copy", "contrast", "fontSize", "primaryAction", "guidance"]) || Object.values(row.feedback).some(item => !FEEDBACK.has(String(item)))) throw new Error("design_partner_feedback_invalid");
  }
  return value as unknown as DesignPartnerEvidence;
}

export function designPartnerEvidenceGate(input: DesignPartnerEvidence) {
  const failures: string[] = [];
  const participants = new Set(input.sessions.map(row => row.participantHash));
  const teams = new Set(input.sessions.map(row => row.teamHash));
  if (input.endedAt < input.startedAt || input.sessions.some(row => row.observedAt < input.startedAt || row.observedAt > input.endedAt)) failures.push("study_timestamps_invalid");
  if (participants.size !== input.sessions.length) failures.push("participant_duplicate");
  if (participants.size < 3) failures.push("three_observed_people_required");
  if (participants.size > 10) failures.push("initial_study_exceeds_ten_people");
  if (teams.size < 2) failures.push("multiple_teams_required");
  if (input.sessions.some(row => row.activation.firstEvidenceResult !== (row.firstEvidenceMs !== null))) failures.push("first_evidence_timing_mismatch");
  if (input.sessions.some(row => row.founderIntervened && row.activation.firstEvidenceResult)) failures.push("founder_assisted_result_not_self_service");
  if (input.securityIncidentCount > 0) failures.push("security_incident_present");

  const selfService = input.sessions.filter(row => row.activation.firstEvidenceResult && !row.founderIntervened).length;
  const repeat = input.sessions.filter(row => row.repeatReviewCompleted).length;
  const trust = input.sessions.filter(row => row.trustBoundaryUnderstood).length;
  const stabilityFailures: string[] = [];
  if (participants.size < 10) stabilityFailures.push("ten_user_stability_sample_required");
  if (participants.size && selfService / participants.size < 0.8) stabilityFailures.push("self_service_activation_below_eighty_percent");
  if (participants.size && repeat / participants.size < 0.5) stabilityFailures.push("repeat_use_below_fifty_percent");
  if (participants.size && trust / participants.size < 0.8) stabilityFailures.push("trust_understanding_below_eighty_percent");
  stabilityFailures.push(...failures);
  return {
    evidencePassed: failures.length === 0,
    broadLaunchPassed: stabilityFailures.length === 0,
    failures: [...new Set(failures)].sort(),
    broadLaunchFailures: [...new Set(stabilityFailures)].sort(),
    measurements: {
      participants: participants.size,
      teams: teams.size,
      selfServiceFirstEvidenceRate: participants.size ? selfService / participants.size : 0,
      repeatUseRate: participants.size ? repeat / participants.size : 0,
      trustBoundaryUnderstandingRate: participants.size ? trust / participants.size : 0,
    },
  };
}
