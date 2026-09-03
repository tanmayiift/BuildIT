import { describe, expect, it } from "vitest";
import { blocksVerdict } from "./coverageGate";

describe("blocksVerdict", () => {
  it("lets a complete review decide", () => {
    expect(blocksVerdict("full", undefined)).toBe(false);
  });

  it("withholds the verdict when a changed file could not be read", () => {
    expect(blocksVerdict("partial", "changed_files")).toBe(true);
  });

  it("withholds the verdict when the diff was truncated", () => {
    expect(blocksVerdict("partial", "diff_truncated")).toBe(true);
  });

  // The case that made every real pull request inconclusive: a description linking an upstream
  // issue in another repository, which BuildIT refuses to fetch on purpose.
  it("still decides when only a requirement source was unreachable", () => {
    expect(blocksVerdict("partial", "requirements")).toBe(false);
  });

  it("fails closed when no cause was recorded", () => {
    expect(blocksVerdict("partial", undefined)).toBe(true);
  });

  it("fails closed on a limited platform-failure snapshot", () => {
    expect(blocksVerdict("limited", undefined)).toBe(true);
  });
});
