import { describe, expect, it } from "vitest";
import { designPartnerEvidenceGate, parseDesignPartnerEvidence, type DesignPartnerEvidence, type DesignPartnerSession } from "../src/designPartnerEvidence.js";

const hash = (value: string) => value.padStart(64, "0");
const session = (participant: string, team: string, changes: Partial<DesignPartnerSession> = {}): DesignPartnerSession => ({
  participantHash: hash(participant), teamHash: hash(team), observerHash: hash("f"), observedAt: 150,
  activation: { landing: true, permissionReceipt: true, repositorySelection: true, exactScopePreview: true, firstEvidenceResult: true },
  firstEvidenceMs: 30_000, founderIntervened: false, ahaMomentReached: true, trustBoundaryUnderstood: true,
  trustOutcome: "trusted", trustNote: "The evidence and human merge boundary made the result understandable.",
  feedback: { copy: "clear", contrast: "clear", fontSize: "clear", primaryAction: "clear", guidance: "clear" },
  exactJob: "manual_pr_review", wouldUseAgain: "yes", repeatReviewCompleted: true, ...changes,
});
const evidence = (sessions: DesignPartnerSession[]): DesignPartnerEvidence => ({
  version: "partners-v1", niche: "Lean B2B software teams with a technical lead review bottleneck", startedAt: 100, endedAt: 200, securityIncidentCount: 0,
  fourLineStatement: { whatBuilt: "Evidence-backed pull request review.", whoFor: "Lean B2B software teams.", whyCare: "Catch risky changes before a human merge.", link: "https://buildit-agentic-review.vercel.app" },
  sessions,
});

describe("design-partner evidence", () => {
  it("accepts three source-free observed people but does not call that broad-launch stability", () => {
    const result = designPartnerEvidenceGate(evidence([session("a", "1"), session("b", "1"), session("c", "2")]));
    expect(result).toMatchObject({ evidencePassed: true, broadLaunchPassed: false, measurements: { participants: 3, teams: 2, selfServiceFirstEvidenceRate: 1 } });
    expect(result.broadLaunchFailures).toContain("ten_user_stability_sample_required");
  });
  it("requires three unique people across multiple teams", () => {
    expect(designPartnerEvidenceGate(evidence([session("a", "1"), session("a", "1")])).failures).toEqual(expect.arrayContaining(["participant_duplicate", "three_observed_people_required", "multiple_teams_required"]));
  });
  it("does not present founder-assisted evidence as self-service", () => {
    const result = designPartnerEvidenceGate(evidence([session("a", "1", { founderIntervened: true }), session("b", "1"), session("c", "2")]));
    expect(result.failures).toContain("founder_assisted_result_not_self_service");
  });
  it("rejects a result whose first-evidence timing was not measured", () => {
    const result = designPartnerEvidenceGate(evidence([session("a", "1", { firstEvidenceMs: null }), session("b", "1"), session("c", "2")]));
    expect(result.failures).toContain("first_evidence_timing_mismatch");
  });
  it("rejects extra identity fields and notes that look like customer or secret data", () => {
    const value = evidence([session("a", "1"), session("b", "1"), session("c", "2")]) as unknown as Record<string, unknown>;
    (value.sessions as Array<Record<string, unknown>>)[0]!.email = "person@example.com";
    expect(() => parseDesignPartnerEvidence(value)).toThrow("design_partner_session_invalid");
    expect(() => parseDesignPartnerEvidence(evidence([session("a", "1", { trustNote: "See github.com/acme/private" }), session("b", "1"), session("c", "2")]))).toThrow("design_partner_session_invalid");
  });
  it("requires ten stable people before a broad-launch pass", () => {
    const rows = Array.from({ length: 10 }, (_, index) => session((index + 1).toString(16), index < 5 ? "a" : "b"));
    expect(designPartnerEvidenceGate(parseDesignPartnerEvidence(evidence(rows)))).toMatchObject({ evidencePassed: true, broadLaunchPassed: true });
  });
});
