import { describe, expect, it } from "vitest";
import { autofixScannerLines, buildAutofixPromptContext, redactAutofixSources, requiredChecksFailingOnBoth, segmentArtifacts } from "./reviewAutofixWorker";
import { verifyArtifactGrant } from "@buildit/security";

const run = (runs: Array<{ scanner: string; scannerVersion: string }>, findings: Array<{ scanner?: string; severity: "critical" | "warning" | "info" }> = []) => ({ scanner: "combined", scannerVersion: "v1", commitSha: "a".repeat(40), complete: true as const, runs, findings });
const inventory = [{ scanner: "builditRules", scannerVersion: "1.0.0" }, { scanner: "gitleaks", scannerVersion: "8.28.0" }, { scanner: "osvScanner", scannerVersion: "2.2.3" }];

describe("Autofix scanner handoff", () => {
  it("attributes each scanner and severity without relabeling findings", () => {
    expect(autofixScannerLines(run(inventory, [{ scanner: "gitleaks", severity: "critical" }, { scanner: "osvScanner", severity: "warning" }, { scanner: "osvScanner", severity: "info" }]))).toEqual([
      "- buildit-rules: **passed** — no findings",
      "- gitleaks: **failed** — 1 Critical",
      "- osv-scanner: **passed** — 1 Warning, 1 Info",
    ]);
  });
  it("fails closed on missing, duplicate, or unknown scanner identity", () => {
    expect(() => autofixScannerLines(run(inventory.slice(0, 2)))).toThrow("autofix_scanner_inventory_invalid");
    expect(() => autofixScannerLines(run([inventory[0]!, inventory[0]!, inventory[2]!]))).toThrow("autofix_scanner_inventory_invalid");
    expect(() => autofixScannerLines(run([inventory[0]!, inventory[1]!, { scanner: "other", scannerVersion: "1" }]))).toThrow("autofix_scanner_inventory_invalid");
    expect(() => autofixScannerLines(run(inventory, [{ severity: "critical" }]))).toThrow("autofix_scanner_inventory_invalid");
  });
});

describe("Autofix retry privacy", () => {
  it("redacts candidate secrets without changing the patch-validation hash", () => {
    const hash = "a".repeat(64), secret = "super-secret-value-123";
    const [source] = redactAutofixSources([{ path: "src/config.ts", content: `token=${secret}\nexport const ok = true`, contentHash: hash }]);
    expect(source?.content).not.toContain(secret);
    expect(source?.content.split("\n")).toHaveLength(2);
    expect(source?.contentHash).toBe(hash);
  });
  it("binds every consented patch request to exact files, accepted findings, and latest checks", () => {
    const hash = "b".repeat(64), context = buildAutofixPromptContext({ originalHeadSha: "a".repeat(40), parentCandidateSha: "c".repeat(40), acceptedFindings: [{ id: "f-1", path: "src/a.ts", resolution: "accepted" }], files: [{ path: "src/a.ts", content: "export const value = 1", contentHash: hash }], latestChecks: { results: [{ planId: "test", status: "failed" }], outputs: [{ planId: "test", text: "expected 2" }] } });
    expect(context).toMatchObject({ authorizedAutofix: true, originalHeadSha: "a".repeat(40), parentCandidateSha: "c".repeat(40), acceptedFindings: [{ id: "f-1", resolution: "accepted" }], files: [{ path: "src/a.ts", contentHash: hash }], latestChecks: { results: [{ status: "failed" }], outputs: [{ text: "expected 2" }] } });
  });
});

// Every autofix round since execution was split into segments died at `scanners`: the read grants were
// minted once per round, `prepare` spent them, and the next segment that reads the repository arrived
// with spent grants. The broker's consume() is modelled exactly - a grantId is accepted once.
describe("what each execution segment is told to read", () => {
  const secret = Buffer.alloc(32, 9);
  const scope = { organizationId: "org" as never, repositoryId: "repo" as never, reviewId: "review" as never };
  const artifacts = [
    { revision: "base" as const, id: "base-0" as never, storageKey: "artifacts/org/repo/review/base-0/context.json", checksum: "a".repeat(64), size: 10 },
    { revision: "head" as const, id: "cand-0" as never, storageKey: "artifacts/org/repo/review/cand-0/autofix-1-abc-candidate-0.json", checksum: "b".repeat(64), size: 20 },
  ];

  it("gives every segment grants the broker has not seen, for the same artifacts", async () => {
    const spent = new Set<string>(), consume = async (grantId: string) => (spent.has(grantId) ? false : (spent.add(grantId), true));
    const describe = segmentArtifacts(scope, artifacts, secret);
    for (const segment of ["prepare", "scanners"]) {
      for (const descriptor of describe()) {
        await expect(verifyArtifactGrant(descriptor.readGrant, secret, { operation: "read", consume }), segment).resolves.toBeDefined();
      }
    }
    const strip = () => describe().map(({ readGrant: _, ...item }) => item);
    expect(strip()).toEqual(strip());
  });
});

describe("whether autofix can ever prove a fix", () => {
  const result = (planId: string, conclusion: string, required = true) => ({ planId, conclusion, required });

  it("names a required check that fails on both commits, which no candidate can pass", () => {
    expect(requiredChecksFailingOnBoth({ base: { results: [result("test", "failed"), result("install", "passed")] }, head: { results: [result("test", "failed"), result("install", "passed")] } })).toEqual(["test"]);
  });

  it("leaves a check the pull request broke to autofix, and ignores advisory checks", () => {
    expect(requiredChecksFailingOnBoth({ base: { results: [result("test", "passed"), result("lint", "failed", false)] }, head: { results: [result("test", "failed"), result("lint", "failed", false)] } })).toEqual([]);
  });

  it("says nothing when there is no base evidence to compare", () => {
    expect(requiredChecksFailingOnBoth({ head: { results: [result("test", "failed")] } })).toEqual([]);
    expect(requiredChecksFailingOnBoth(undefined)).toEqual([]);
  });
});
