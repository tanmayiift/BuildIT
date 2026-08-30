import { describe, expect, it } from "vitest";
import { detectPackageManager, revisionFromStorageKey, summarizeExecution, type ExecutionResponse } from "./validationEvidence";

describe("validation evidence", () => {
  it("requires the same unambiguous package manager on base and head", () => {
    expect(detectPackageManager({ base: new Set(["package.json", "pnpm-lock.yaml"]), head: new Set(["package.json", "pnpm-lock.yaml"]) })).toBe("pnpm");
    expect(() => detectPackageManager({ base: new Set(["package.json", "pnpm-lock.yaml"]), head: new Set(["package.json", "package-lock.json"]) })).toThrow("package_manager_changed");
    expect(() => detectPackageManager({ base: new Set(["package.json", "pnpm-lock.yaml", "yarn.lock"]), head: new Set(["package.json", "pnpm-lock.yaml"]) })).toThrow("package_manager_unsupported_or_ambiguous");
  });

  it("derives revision only from the collision-safe artifact name", () => {
    expect(revisionFromStorageKey("artifacts/o/r/v/a/context-base-12.json")).toBe("base");
    expect(() => revisionFromStorageKey("artifacts/o/r/v/a/context-12.json")).toThrow("context_artifact_revision_invalid");
  });

  it("refuses missing teardown proof and records a critical scanner failure", () => {
    const plan = { planId: "test", origin: "built_in", kind: "test", executable: "npm", args: ["run", "test"], required: true, timeoutMs: 45_000, cpuLimit: 2, memoryMb: 4096, outputBytes: 10_000_000, fileBytes: 1_000_000_000, network: "none", conclusion: "passed", exitCode: 0, durationMs: 5 } as const;
    const run = (commitSha: string, critical = false) => ({ credentialTeardownProved: true, stopped: true, results: [plan], outputs: [], scanner: { scanner: "builditRules", scannerVersion: "1.0.0", commitSha, complete: true as const, findings: critical ? [{ severity: "critical" as const }] : [] } });
    const baseSha = "a".repeat(40), headSha = "b".repeat(40), base = run(baseSha), head = run(headSha, true);
    const output = { base, head, scanners: { base: base.scanner, head: head.scanner } } as unknown as ExecutionResponse;
    expect(summarizeExecution(output, baseSha, headSha).at(-1)).toMatchObject({ revision: "head", kind: "static_analysis", conclusion: "failed" });
    output.head.credentialTeardownProved = false;
    expect(() => summarizeExecution(output, baseSha, headSha)).toThrow("credential_teardown_unproved");
  });
});
