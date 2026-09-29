import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// rate_limited and quota_exhausted both answer 429, and only execution-http declared an error code
// on its response - so at the metric layer both arrived as an identical `http_429`. An account with
// no credit was indistinguishable from one going too fast, which matters because the first never
// clears on its own and the second always does.
const root = join(process.cwd(), "packages");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("a spent account is distinguishable from a rate limit", () => {
  it("declares the code on the response, the way execution-http already does", () => {
    expect(read("broker/src/model-http.ts")).toContain('"x-buildit-error-code": "quota_exhausted"');
  });

  // Declared is not enough: two allowlists drop an unknown code silently, which is exactly how a
  // header can look correct and still never reach a metric.
  it("survives both error-code allowlists on the way to a label", () => {
    expect(read("broker/src/telemetry-ingest.ts"), "the ingest drops codes it does not know").toContain('"quota_exhausted"');
    expect(read("telemetry/src/index.ts"), "safeAttributes drops codes it does not know").toContain('"quota_exhausted"');
  });
});
