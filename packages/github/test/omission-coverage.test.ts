import { describe, expect, it } from "vitest";
import { isForcedOmission, omissionCoverage, type RepositoryOmission } from "../src/repository-content.js";

const omission = (path: string, reason: RepositoryOmission["reason"]): RepositoryOmission => ({ path, reason });

describe("repository coverage counts only forced omissions", () => {
  it("treats an empty omission list as full coverage", () => {
    expect(omissionCoverage([])).toBe("full");
  });

  // The production defect: this repository tracks 22 committed .png snapshots, every one of
  // them omitted as "excluded". Under the old rule a single image made every review of the
  // repository permanently inconclusive, before a check was even considered.
  it("keeps full coverage when only deliberately excluded assets are omitted", () => {
    const omitted = [
      omission("tests/e2e/accessibility.spec.ts-snapshots/landing-desktop.png", "excluded"),
      omission("node_modules/left-pad/index.js", "excluded"),
      omission("dist/bundle.min.js", "excluded"),
    ];
    expect(omissionCoverage(omitted)).toBe("full");
    expect(omitted.some(isForcedOmission)).toBe(false);
  });

  it("keeps full coverage for binary content that has no reviewable text", () => {
    expect(omissionCoverage([omission("assets/logo.bin", "binary")])).toBe("full");
  });

  it("reports partial coverage when a file was wanted but too large", () => {
    expect(omissionCoverage([omission("src/generated.ts", "oversized")])).toBe("partial");
    expect(isForcedOmission(omission("src/generated.ts", "oversized"))).toBe(true);
  });

  it("reports partial coverage when the fetch budget cut real source off", () => {
    expect(omissionCoverage([omission("src/deep/module.ts", "budget")])).toBe("partial");
    expect(isForcedOmission(omission("src/deep/module.ts", "budget"))).toBe(true);
  });

  it("still reports partial when a forced omission hides among excluded assets", () => {
    expect(omissionCoverage([
      omission("docs/diagram.png", "excluded"),
      omission("src/huge.ts", "oversized"),
      omission("icon.ico", "excluded"),
    ])).toBe("partial");
  });
});
