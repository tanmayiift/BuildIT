import { createHash } from "node:crypto";

export type PatchProposal = { path: string; rationale: string; findingIds: string[]; expectedContentHash: string; replacementContent: string };
export type PatchSource = { path: string; content: string; contentHash: string };
export type ValidatedPatch = PatchProposal & { previousContent: string };

const protectedPath = /^(?:\.github\/|\.gitlab\/|\.circleci\/|\.vercel\/|migrations?\/|db\/migrations?\/|terraform\/|infra\/)|(?:^|\/)(?:CODEOWNERS|Dockerfile(?:\..*)?|vercel\.json|package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|pyproject\.toml|requirements(?:-[^.\/]+)?\.txt|poetry\.lock|pom\.xml|build\.gradle(?:\.kts)?|go\.(?:mod|sum)|Cargo\.(?:toml|lock)|\.env(?:\..*)?)$/i;
const secretPattern = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_\-/.+=]{16,}["']/i;
const safePath = (path: string) => path.length > 0 && path.length <= 500 && !path.startsWith("/") && !path.includes("\0") && !path.split("/").includes("..") && !path.startsWith(".git/");
export const contentHash = (content: string) => createHash("sha256").update(content).digest("hex");

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
