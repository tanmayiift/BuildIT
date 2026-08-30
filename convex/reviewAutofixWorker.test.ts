import { describe, expect, it } from "vitest";
import { autofixScannerLines } from "./reviewAutofixWorker";

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
