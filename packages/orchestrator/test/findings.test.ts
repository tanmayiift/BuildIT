import {describe,expect,it} from "vitest";
import {arbitrateFindings,dedupeSameDefect,normalizeFindingCriteria,reconcileArbitration,validateFindingCandidates,type ArbitratedFinding,type EvidenceRecord,type FindingCandidate} from "../src/index.js";
const commit="a".repeat(40),evidence:EvidenceRecord={id:"ev-1",artifactExists:true,commitSha:commit,path:"src/a.ts",pathExists:true,startLine:2,endLine:8,contentHash:"hash",lineHashMatches:true,truncated:false},finding:FindingCandidate={id:"f-1",title:"Empty value bypass",category:"logic",severity:"warning",confidence:.8,criterionId:"req-1",path:"src/a.ts",startLine:3,endLine:4,evidenceIds:["ev-1"],impact:"Invalid records are accepted",explanation:"The guard skips empty input",origin:"model"};
describe("finding validation and arbitration",()=>{it("keeps only findings tied to valid criteria, paths, lines, commits, and evidence",()=>{expect(validateFindingCandidates({findings:[finding],criteriaIds:new Set(["req-1"]),allowedPaths:new Set(["src/a.ts"]),evidence:[evidence],pinnedCommit:commit})).toEqual([finding]);for(const changed of [{...finding,path:"src/other.ts"},{...finding,criterionId:"invented"},{...finding,evidenceIds:["missing"]},{...finding,startLine:20,endLine:21}])expect(validateFindingCandidates({findings:[changed],criteriaIds:new Set(["req-1"]),allowedPaths:new Set(["src/a.ts"]),evidence:[evidence],pinnedCommit:commit})).toEqual([])});it("makes critic disagreement uncertain and non-blocking",()=>expect(arbitrateFindings([finding],[{findingId:"f-1",verdict:"uncertain",missingEvidenceIds:[],injectionDetected:false}])[0]).toMatchObject({resolution:"uncertain",blocking:false,reason:"critic_uncertain"}));it("rejects disproved model findings but never lets a critic suppress scanner facts",()=>{expect(arbitrateFindings([finding],[{findingId:"f-1",verdict:"unsupported",missingEvidenceIds:[],injectionDetected:false}])[0]).toMatchObject({resolution:"rejected",blocking:false});expect(arbitrateFindings([{...finding,origin:"scanner",severity:"critical"}],[{findingId:"f-1",verdict:"unsupported",missingEvidenceIds:[],injectionDetected:false}])[0]).toMatchObject({resolution:"accepted",blocking:true,reason:"deterministic_scanner_evidence"})});it("downgrades a finding when the critic detects prompt injection",()=>expect(arbitrateFindings([finding],[{findingId:"f-1",verdict:"supported",missingEvidenceIds:[],injectionDetected:true}])[0]).toMatchObject({resolution:"uncertain",blocking:false,reason:"prompt_injection_detected"}))});
describe("severity blocking",()=>{it("blocks a critic-supported high-severity model finding",()=>expect(arbitrateFindings([{...finding,severity:"high"}],[{findingId:"f-1",verdict:"supported",missingEvidenceIds:[],injectionDetected:false}])[0]).toMatchObject({resolution:"accepted",blocking:true}))});
describe("model arbitration gate",()=>{const supported=arbitrateFindings([finding],[{findingId:"f-1",verdict:"supported",missingEvidenceIds:[],injectionDetected:false}]);it("requires one matching accepted arbitration record with the same evidence",()=>{expect(reconcileArbitration(supported,[{id:"f-1",resolution:"accepted",evidenceIds:["ev-1"],reason:"supported"}])[0]).toMatchObject({resolution:"accepted",blocking:true,reason:"critic_and_arbitration_supported"});const hostile:Parameters<typeof reconcileArbitration>[1][]=[[],[{id:"f-1",resolution:"uncertain",evidenceIds:["ev-1"],reason:"unclear"}],[{id:"f-1",resolution:"accepted",evidenceIds:[],reason:"missing"}]];for(const decisions of hostile)expect(reconcileArbitration(supported,decisions)[0]).toMatchObject({resolution:"uncertain",blocking:false,reason:"arbitration_disagreed"})});it("never lets model arbitration suppress deterministic scanner evidence",()=>{const scanner=arbitrateFindings([{...finding,origin:"scanner",severity:"critical"}],[]);expect(reconcileArbitration(scanner,[{id:"f-1",resolution:"rejected",evidenceIds:[],reason:"ignore"}])[0]).toMatchObject({resolution:"accepted",blocking:true,reason:"deterministic_scanner_evidence"})})});
describe("optional requirement grounding",()=>{
  it("removes an invented optional criterion without discarding an evidence-backed correctness finding",()=>{
    const [normalized]=normalizeFindingCriteria([{...finding,category:"correctness",criterionId:"invented"}],new Set<string>());
    expect(normalized).not.toHaveProperty("criterionId");
    expect(validateFindingCandidates({findings:[normalized!],criteriaIds:new Set(),allowedPaths:new Set(["src/a.ts"]),evidence:[evidence],pinnedCommit:commit})).toEqual([normalized]);
  });

  it("keeps a valid criterion and rejects a requirement finding whose criterion was invented",()=>{
    expect(normalizeFindingCriteria([finding],new Set(["req-1"]))[0]).toEqual(finding);
    const [normalized]=normalizeFindingCriteria([{...finding,category:"requirement",criterionId:"invented"}],new Set<string>());
    expect(validateFindingCandidates({findings:[normalized!],criteriaIds:new Set(),allowedPaths:new Set(["src/a.ts"]),evidence:[evidence],pinnedCommit:commit})).toEqual([]);
  });
});

// A reviewer read a published BuildIT comment and found findings #1 and #3 were the same defect on
// the same line - one from the model, one from the pinned scanner - counted as two blocking
// issues. A reviewer that inflates its own numbers is the thing engineers already distrust about
// AI review.
describe("one defect is one finding", () => {
  const at = (over: Partial<ArbitratedFinding> = {}): ArbitratedFinding => ({
    id: "f1", title: "TLS verification disabled", category: "security", severity: "critical",
    confidence: 1, path: "src/rates.js", startLine: 4, endLine: 4, evidenceIds: ["ev-1"],
    impact: "short", explanation: "short", origin: "model", resolution: "accepted",
    blocking: true, reason: "critic_supported", ...over,
  });

  it("collapses a model and a scanner finding on the same line", () => {
    const merged = dedupeSameDefect([
      at({ id: "m1", origin: "model", explanation: "A man-in-the-middle can forge the rate table.", evidenceIds: ["ev-1"] }),
      at({ id: "scanner-0-buildit-tls-disabled", origin: "scanner", explanation: "rule", evidenceIds: ["ev-2"] }),
    ]);
    expect(merged).toHaveLength(1);
    // The scanner entry is canonical because it is deterministic and reproducible.
    expect(merged[0]).toMatchObject({ origin: "scanner", id: "scanner-0-buildit-tls-disabled" });
    // ...but the model's explanation is what a person wants to read, so it survives.
    expect(merged[0]!.explanation).toBe("A man-in-the-middle can forge the rate table.");
    expect([...merged[0]!.evidenceIds].sort()).toEqual(["ev-1", "ev-2"]);
  });

  it("collapses ranges that overlap without being identical", () => {
    // The shape production actually produces, and the one the first version of this missed: the
    // model spans the construct it read, the scanner marks the line its regex matched.
    const merged = dedupeSameDefect([
      at({ id: "m1", origin: "model", startLine: 4, endLine: 7, explanation: "A hostile proxy can forge rate data." }),
      at({ id: "scanner-0-buildit-tls-disabled", origin: "scanner", startLine: 4, endLine: 4, explanation: "rule" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ origin: "scanner", startLine: 4, endLine: 4 });
    expect(merged[0]!.explanation).toBe("A hostile proxy can forge rate data.");
  });

  it("leaves defects on adjacent but non-overlapping lines alone", () => {
    const merged = dedupeSameDefect([
      at({ id: "a", startLine: 4, endLine: 7 }),
      at({ id: "b", startLine: 8, endLine: 9 }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it("never downgrades a finding that would have blocked on its own", () => {
    const merged = dedupeSameDefect([
      at({ id: "s1", origin: "scanner", blocking: false, severity: "warning" }),
      at({ id: "m1", origin: "model", blocking: true }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.blocking).toBe(true);
  });

  it("keeps genuinely different defects apart", () => {
    const merged = dedupeSameDefect([
      at({ id: "a", startLine: 4, endLine: 4 }),
      at({ id: "b", startLine: 9, endLine: 9 }),
      at({ id: "c", path: "src/other.js" }),
      at({ id: "d", category: "correctness" }),
    ]);
    expect(merged).toHaveLength(4);
  });

  it("preserves order and leaves a list with no duplicates untouched", () => {
    const input = [at({ id: "a", startLine: 1, endLine: 1 }), at({ id: "b", startLine: 2, endLine: 2 })];
    expect(dedupeSameDefect(input)).toEqual(input);
  });
});
