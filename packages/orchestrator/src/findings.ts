import {validEvidence,type EvidenceRecord} from "./index.js";
export type FindingSeverity="critical"|"high"|"warning"|"info";
export type FindingCandidate={id:string;title:string;category:string;severity:FindingSeverity;confidence:number;criterionId?:string;path:string;startLine:number;endLine:number;evidenceIds:string[];impact:string;explanation:string;origin:"model"|"scanner"};
export type CriticDecision={findingId:string;verdict:"supported"|"unsupported"|"uncertain";missingEvidenceIds:string[];injectionDetected:boolean};
export type ArbitrationDecision={id:string;resolution:"accepted"|"rejected"|"uncertain";evidenceIds:string[];reason:string};
export type ArbitratedFinding=FindingCandidate&{resolution:"accepted"|"rejected"|"uncertain";blocking:boolean;reason:string};
export function normalizeFindingCriteria(findings:FindingCandidate[],criteriaIds:Set<string>){return findings.map(finding=>{if(!finding.criterionId||criteriaIds.has(finding.criterionId))return finding;const{criterionId:_discarded,...grounded}=finding;return grounded})}
export function validateFindingCandidates(input:{findings:FindingCandidate[];criteriaIds:Set<string>;allowedPaths:Set<string>;evidence:EvidenceRecord[];pinnedCommit:string}){const evidence=new Map(input.evidence.filter(item=>validEvidence(item,input.pinnedCommit)).map(item=>[item.id,item]));return input.findings.filter(finding=>finding.id&&finding.title.trim()&&finding.impact.trim()&&finding.explanation.trim()&&Number.isFinite(finding.confidence)&&finding.confidence>=0&&finding.confidence<=1&&input.allowedPaths.has(finding.path)&&Number.isInteger(finding.startLine)&&finding.startLine>0&&Number.isInteger(finding.endLine)&&finding.endLine>=finding.startLine&&finding.evidenceIds.length>0&&finding.evidenceIds.every(id=>evidence.has(id))&&(!finding.criterionId||input.criteriaIds.has(finding.criterionId))&&(finding.category!=="requirement"||Boolean(finding.criterionId))&&finding.evidenceIds.some(id=>{const item=evidence.get(id)!;return item.path===finding.path&&item.startLine!<=finding.startLine&&item.endLine!>=finding.endLine}))}
export function arbitrateFindings(findings:FindingCandidate[],critic:CriticDecision[]):ArbitratedFinding[]{const decisions=new Map(critic.map(item=>[item.findingId,item]));return findings.map(finding=>{const decision=decisions.get(finding.id);if(finding.origin==="scanner")return{...finding,resolution:"accepted",blocking:finding.severity==="critical",reason:"deterministic_scanner_evidence"};if(!decision)return{...finding,resolution:"uncertain",blocking:false,reason:"critic_missing"};if(decision.injectionDetected)return{...finding,resolution:"uncertain",blocking:false,reason:"prompt_injection_detected"};if(decision.verdict==="unsupported")return{...finding,resolution:"rejected",blocking:false,reason:"critic_disproved"};if(decision.verdict==="uncertain"||decision.missingEvidenceIds.length)return{...finding,resolution:"uncertain",blocking:false,reason:"critic_uncertain"};return{...finding,resolution:"accepted",blocking:finding.severity==="critical"||finding.severity==="high"||finding.severity==="warning",reason:"critic_supported"}})}
export function reconcileArbitration(findings:ArbitratedFinding[],decisions:ArbitrationDecision[]):ArbitratedFinding[]{
 const grouped=new Map<string,ArbitrationDecision[]>();for(const decision of decisions){const group=grouped.get(decision.id)??[];group.push(decision);grouped.set(decision.id,group)}
 return findings.map(finding=>{if(finding.origin==="scanner"||finding.resolution!=="accepted")return finding;const matches=grouped.get(finding.id)??[],decision=matches.length===1?matches[0]:undefined;
  if(!decision||decision.resolution!=="accepted"||!finding.evidenceIds.every(id=>decision.evidenceIds.includes(id)))return{...finding,resolution:"uncertain",blocking:false,reason:matches.length>1?"arbitration_duplicate":"arbitration_disagreed"};
  return{...finding,reason:"critic_and_arbitration_supported"};
 })
}

// A defect found by both the model and a pinned scanner arrived as two findings and was counted
// twice: "3 blocking issues" where a reader could see two. Nothing collapsed them, because the two
// carry different ids by construction - the scanner's is synthesised - so the fingerprint dedupe
// downstream can never match them.
//
// The scanner entry survives as canonical: it is deterministic, reproducible, and already carries
// confidence 1. The model's prose is merged into it rather than discarded, so the report keeps the
// explanation a person actually wants to read and loses only the double count.
export function dedupeSameDefect(findings: ArbitratedFinding[]): ArbitratedFinding[] {
  // Keyed on overlap, not on equality. The first version of this required identical line ranges
  // and production immediately proved that wrong: for one disabled-TLS line the model reported
  // 4-7, spanning the construct it read, while the scanner reported 4, the line its regex matched.
  // Same defect, different ranges, still counted twice.
  const sameDefect = (a: ArbitratedFinding, b: ArbitratedFinding) =>
    a.path === b.path && a.category === b.category && a.startLine <= b.endLine && b.startLine <= a.endLine;
  const kept: ArbitratedFinding[] = [];
  for (const finding of findings) {
    const index = kept.findIndex(existing => sameDefect(existing, finding));
    if (index === -1) { kept.push(finding); continue; }
    const existing = kept[index]!;
    // Prefer the scanner: it is deterministic and reproducible. Then prefer whichever actually
    // blocks - a merge must never quietly downgrade a finding that would have blocked alone.
    const winner = existing.origin === "scanner" ? existing
      : finding.origin === "scanner" ? finding
      : existing.blocking ? existing : finding;
    const loser = winner === existing ? finding : existing;
    kept[index] = {
      ...winner,
      blocking: winner.blocking || loser.blocking,
      // The model explains why it matters; the scanner states the rule. Keep the longer text, and
      // keep the winner's line range so the fingerprint stays stable across runs.
      explanation: loser.explanation.length > winner.explanation.length ? loser.explanation : winner.explanation,
      impact: loser.impact.length > winner.impact.length ? loser.impact : winner.impact,
      evidenceIds: [...new Set([...winner.evidenceIds, ...loser.evidenceIds])],
    };
  }
  return kept;
}
