import { describe, expect, it } from "vitest";
import { contentHash, validatePatchProposals } from "../src/patchPolicy";

const source = "export const tax = 1;\n", hash = contentHash(source), accepted = new Set(["finding-1"]);
const proposal = { path: "src/tax.ts", rationale: "Fix supported tax finding", findingIds: ["finding-1"], expectedContentHash: hash, replacementContent: "export const tax = 2;\n" };

describe("Autofix patch policy", () => {
  it("accepts an exact-source replacement tied to an accepted finding", () => expect(validatePatchProposals({ proposals: [proposal], sources: [{ path: proposal.path, content: source, contentHash: hash }], acceptedFindingIds: accepted })).toEqual([{ ...proposal, previousContent: source }]));
  it("rejects stale content, unsupported findings, duplicate and protected paths", () => {
    expect(() => validatePatchProposals({ proposals: [{ ...proposal, expectedContentHash: "a".repeat(64) }], sources: [{ path: proposal.path, content: source, contentHash: hash }], acceptedFindingIds: accepted })).toThrow("patch_source_mismatch");
    expect(() => validatePatchProposals({ proposals: [{ ...proposal, findingIds: ["invented"] }], sources: [{ path: proposal.path, content: source, contentHash: hash }], acceptedFindingIds: accepted })).toThrow("patch_finding_scope_invalid");
    expect(() => validatePatchProposals({ proposals: [proposal, proposal], sources: [{ path: proposal.path, content: source, contentHash: hash }], acceptedFindingIds: accepted })).toThrow("patch_path_duplicate");
    expect(() => validatePatchProposals({ proposals: [{ ...proposal, path: ".github/workflows/release.yml" }], sources: [{ path: ".github/workflows/release.yml", content: source, contentHash: hash }], acceptedFindingIds: accepted })).toThrow("patch_path_protected");
  });
  it("rejects empty, oversized, and likely-secret replacements", () => {
    expect(() => validatePatchProposals({ proposals: [{ ...proposal, replacementContent: source }], sources: [{ path: proposal.path, content: source, contentHash: hash }], acceptedFindingIds: accepted })).toThrow("patch_empty");
    expect(() => validatePatchProposals({ proposals: [{ ...proposal, replacementContent: "x".repeat(10) }], sources: [{ path: proposal.path, content: source, contentHash: hash }], acceptedFindingIds: accepted, maxBytes: 5 })).toThrow("patch_byte_limit_exceeded");
    expect(() => validatePatchProposals({ proposals: [{ ...proposal, replacementContent: 'api_key = "abcdefghijklmnop1234"' }], sources: [{ path: proposal.path, content: source, contentHash: hash }], acceptedFindingIds: accepted })).toThrow("patch_potential_secret");
  });
});
