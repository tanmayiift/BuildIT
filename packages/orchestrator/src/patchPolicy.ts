import { createHash } from "node:crypto";

export type PatchProposal = { path: string; rationale: string; findingIds: string[]; expectedContentHash: string; replacementContent: string };
export type PatchSource = { path: string; content: string; contentHash: string };
export type ValidatedPatch = PatchProposal & { previousContent: string };

const protectedPath = /^(?:\.github\/|\.gitlab\/|\.circleci\/|\.vercel\/|migrations?\/|db\/migrations?\/|terraform\/|infra\/)|(?:^|\/)(?:CODEOWNERS|Dockerfile(?:\..*)?|vercel\.json|package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|pyproject\.toml|requirements(?:-[^.\/]+)?\.txt|poetry\.lock|pom\.xml|build\.gradle(?:\.kts)?|go\.(?:mod|sum)|Cargo\.(?:toml|lock)|\.env(?:\..*)?)$/i;
const secretPattern = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_\-/.+=]{16,}["']/i;
const safePath = (path: string) => path.length > 0 && path.length <= 500 && !path.startsWith("/") && !path.includes("\0") && !path.split("/").includes("..") && !path.startsWith(".git/");
export const contentHash = (content: string) => createHash("sha256").update(content).digest("hex");
export function assertAutofixBounds(input:{completedRounds:number;modelAttempts:number;startedAt:number;now:number;budgetConsumed:number;budgetLimit:number;maxDurationMs?:number}){const maxDuration=input.maxDurationMs??45*60_000;if(!Number.isInteger(input.completedRounds)||input.completedRounds<0||input.completedRounds>=3)throw new Error("autofix_round_limit");if(!Number.isInteger(input.modelAttempts)||input.modelAttempts<0||input.modelAttempts>=6)throw new Error("autofix_attempt_limit");if(!Number.isFinite(input.startedAt)||!Number.isFinite(input.now)||input.now<input.startedAt||input.now-input.startedAt>maxDuration)throw new Error("autofix_time_limit");if(!Number.isFinite(input.budgetLimit)||input.budgetLimit<0||!Number.isFinite(input.budgetConsumed)||input.budgetConsumed<0||input.budgetConsumed>=input.budgetLimit)throw new Error("autofix_spend_limit");return{roundNumber:input.completedRounds+1,remainingAttempts:6-input.modelAttempts,deadline:input.startedAt+maxDuration}}
export function conservativeModelCost(inputTokens:number,outputTokens:number){if(!Number.isSafeInteger(inputTokens)||inputTokens<0||!Number.isSafeInteger(outputTokens)||outputTokens<0)throw new Error("model_usage_invalid");return inputTokens*15/1_000_000+outputTokens*75/1_000_000}
// A provider reports actual tokens only after it has accepted a request. Before
// sending one, BuildIT uses the byte count as a deliberately high input-token
// estimate and includes fixed policy/tool-schema overhead. This is a safety
// ceiling, not an invoice estimate.
export function conservativeStageCost(inputBytes:number,maxOutputTokens:number,overheadTokens=4_096){if(!Number.isSafeInteger(inputBytes)||inputBytes<0||!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<0||!Number.isSafeInteger(overheadTokens)||overheadTokens<0)throw new Error("model_stage_cost_invalid");return conservativeModelCost(inputBytes+overheadTokens,maxOutputTokens)}
type CandidateCheck={planId:string;required:boolean;conclusion:"passed"|"failed"|"not_run"|"timed_out"|"truncated"|"flaky"};
export function candidateWorsened(input:{parent:CandidateCheck[];candidate:CandidateCheck[];parentCriticalFindings:number;candidateCriticalFindings:number}){if(input.candidateCriticalFindings>input.parentCriticalFindings)return{worsened:true as const,reason:"critical_scanner_increase"};const parent=new Map(input.parent.filter(item=>item.required).map(item=>[item.planId,item]));for(const item of input.candidate.filter(item=>item.required)){const before=parent.get(item.planId);if(before?.conclusion==="passed"&&item.conclusion!=="passed")return{worsened:true as const,reason:`required_check_regressed:${item.planId}`};if(before?.conclusion==="failed"&&!['passed','failed'].includes(item.conclusion))return{worsened:true as const,reason:`required_check_became_inconclusive:${item.planId}`}}return{worsened:false as const}}

export function validatePatchProposals(input: { proposals: PatchProposal[]; sources: PatchSource[]; acceptedFindingIds: Set<string>; maxFiles?: number; maxBytes?: number }): ValidatedPatch[] {
  const maxFiles = input.maxFiles ?? 20, maxBytes = input.maxBytes ?? 500_000;
  if (!input.proposals.length) return [];
  if (input.proposals.length > maxFiles) throw new Error("patch_file_limit_exceeded");
  const sources = new Map(input.sources.map(item => [item.path, item])), seen = new Set<string>(), validated: ValidatedPatch[] = [];
  let bytes = 0;
  for (const proposal of input.proposals) {
    if (!safePath(proposal.path) || protectedPath.test(proposal.path)) throw new Error("patch_path_protected");
    if (seen.has(proposal.path)) throw new Error("patch_path_duplicate");
    seen.add(proposal.path);
    const source = sources.get(proposal.path);
    if (!source || !/^[0-9a-f]{64}$/.test(proposal.expectedContentHash) || source.contentHash !== proposal.expectedContentHash || contentHash(source.content) !== proposal.expectedContentHash) throw new Error("patch_source_mismatch");
    if (!proposal.rationale.trim() || !proposal.findingIds.length || proposal.findingIds.some(id => !input.acceptedFindingIds.has(id))) throw new Error("patch_finding_scope_invalid");
    if (proposal.replacementContent === source.content) throw new Error("patch_empty");
    if (proposal.replacementContent.includes("\0")) throw new Error("patch_content_invalid");
    if (secretPattern.test(proposal.replacementContent)) throw new Error("patch_potential_secret");
    bytes += Buffer.byteLength(proposal.replacementContent);
    if (bytes > maxBytes) throw new Error("patch_byte_limit_exceeded");
    validated.push({ ...proposal, previousContent: source.content });
  }
  return validated;
}
