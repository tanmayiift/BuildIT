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

// Every real repository was coming back "partial", and partial coverage makes the verdict
// inconclusive. One lockfile or one image over the size cap was enough, so a user could watch all
// seven checks pass and still be told BuildIT could not decide. Measured across every review this
// deployment produced: the vercel/ms forks and BuildIT's own repository were all partial; only the
// tiny fixture ever reached full.
//
// Coverage has to answer "did I read the code this pull request changed", not "did I read every
// byte of the repository". An unrelated asset that did not fit cannot make a verdict on a
// three-line diff unsafe.
describe("coverage is about the code under review", () => {
  const oversized = (path: string): RepositoryOmission => ({ path, reason: "oversized" });

  it("stays full when the skipped file is nothing to do with the change", () => {
    const omitted = [oversized("assets/demo-video.mp4"), oversized("pnpm-lock.yaml")];
    expect(omissionCoverage(omitted, new Set(["src/rates.js"]))).toBe("full");
  });

  it("goes partial when a file the pull request changed could not be read", () => {
    const omitted = [oversized("assets/demo-video.mp4"), oversized("src/generated/schema.ts")];
    expect(omissionCoverage(omitted, new Set(["src/generated/schema.ts"]))).toBe("partial");
  });

  it("stays strict when the changed set is unknown", () => {
    // No changed set means no way to tell relevant from irrelevant, so it must not guess in the
    // direction that produces a confident verdict.
    expect(omissionCoverage([oversized("anything.bin")])).toBe("partial");
    expect(omissionCoverage([oversized("anything.bin")], undefined)).toBe("partial");
  });

  it("still ignores omissions that were never evidence gaps", () => {
    const permanent: RepositoryOmission[] = [{ path: "logo.png", reason: "excluded" }, { path: "a.bin", reason: "binary" }];
    expect(omissionCoverage(permanent, new Set(["logo.png", "a.bin"]))).toBe("full");
  });
});
