import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanErrorCode, scanErrorCodes, scanErrorMessage, type ScanErrorCode } from "./scan-error-state";

const route = readFileSync(join(import.meta.dirname, "..", "api", "scan", "route.ts"), "utf8");

function limit(name: string) {
  const match = route.match(new RegExp(`const ${name} = ([\\d_]+);`));
  if (!match) throw new Error(`scan route no longer defines ${name}`);
  return Number(match[1]!.replaceAll("_", ""));
}

describe("what the open sandbox tells a visitor when the check is refused", () => {
  // The endpoint is the source of truth for which refusals exist. Adding a reject() there without
  // a sentence here would put a raw code back in front of the one audience that has no account,
  // no context and no reason to guess what it means.
  it("has a sentence for every refusal the endpoint can return", () => {
    const emitted = [...route.matchAll(/reject\(\d+, "([a-z_]+)"\)/g)].map(match => match[1]!);
    expect(emitted.length).toBeGreaterThan(0);
    for (const code of new Set(emitted)) {
      expect(scanErrorCodes as readonly string[], `${code} has no sentence`).toContain(code);
    }
  });

  it("never shows the reader an identifier", () => {
    for (const code of [...scanErrorCodes, "scan_failed"] as ScanErrorCode[]) {
      const message = scanErrorMessage(code);
      expect(message, code).not.toContain(code);
      expect(message, code).not.toMatch(/[a-z]+_[a-z]+/);
    }
  });

  it("says what happened and what to do, in whole sentences", () => {
    for (const code of [...scanErrorCodes, "scan_failed"] as ScanErrorCode[]) {
      const message = scanErrorMessage(code);
      expect(message.split(". ").length, code).toBeGreaterThan(1);
      expect(message.endsWith("."), code).toBe(true);
    }
  });

  // A sentence that quotes a limit the endpoint does not enforce sends someone away to trim code
  // that would have been accepted, so the numbers are read back out of the route.
  it("quotes the limits the endpoint actually enforces", () => {
    expect(scanErrorMessage("request_too_large")).toContain(`${limit("maxBodyBytes") / 1000} KB`);
    expect(scanErrorMessage("too_many_files")).toContain(`${limit("maxFiles")} files`);
    expect(scanErrorMessage("file_too_long")).toContain(`${limit("maxLinesPerFile").toLocaleString("en-US")} lines`);
  });

  it("keeps the offline case, which the endpoint never reports because it was never reached", () => {
    expect(scanErrorCode("network_unavailable")).toBe("network_unavailable");
    expect(scanErrorMessage("network_unavailable")).toContain("nothing was sent");
  });

  // The page falls back to `request_failed_${status}` when a non-OK response carries no code, and
  // a proxy or a future deployment can return anything at all.
  it("refuses to render a code it does not recognize", () => {
    for (const value of ["request_failed_502", "", "undefined", "<html>Gateway Timeout</html>", new Error("upstream 500")]) {
      expect(scanErrorCode(value)).toBe("scan_failed");
    }
    expect(scanErrorMessage(scanErrorCode("request_failed_502"))).not.toContain("502");
  });

  it("maps each refusal to its own sentence", () => {
    const messages = [...scanErrorCodes, "scan_failed"].map(code => scanErrorMessage(code as ScanErrorCode));
    expect(new Set(messages).size).toBe(messages.length);
  });
});
