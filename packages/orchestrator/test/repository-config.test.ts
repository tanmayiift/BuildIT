import { describe, expect, it } from "vitest";
import { parseRepositoryConfig } from "../src/repositoryConfig.js";

// trustedConfiguration has existed and gone unused since the beginning. It decides whether a
// repository's own configuration may be believed, and it already refuses configuration taken from
// a pull request head - which is the whole security property here: otherwise anyone opening a pull
// request could rewrite the rules the review runs under, in the pull request being reviewed.
//
// This is only the parser. It is deliberately total: a config file is written by a person, and a
// typo in it is not a reason to refuse to review their code.

describe("reading .buildit.yml", () => {
  it("reads the settings that already exist", () => {
    const result = parseRepositoryConfig([
      "reviewProfile: quiet",
      "reviewTrigger: automatic",
      "pathFilters:",
      "  - '!vendor/**'",
      "  - '!**/*.generated.ts'",
    ].join("\n"));
    expect(result.valid).toBe(true);
    expect(result.config).toEqual({
      reviewProfile: "quiet",
      reviewTrigger: "automatic",
      pathFilters: ["!vendor/**", "!**/*.generated.ts"],
    });
  });

  it("reads per-path instructions", () => {
    const result = parseRepositoryConfig([
      "pathInstructions:",
      "  - path: 'src/auth/**'",
      "    instructions: 'Pay attention to input validation.'",
    ].join("\n"));
    expect(result.config.pathInstructions).toEqual([
      { path: "src/auth/**", instructions: "Pay attention to input validation." },
    ]);
  });

  it("treats an empty file as no configuration rather than an error", () => {
    expect(parseRepositoryConfig("")).toMatchObject({ valid: true, config: {} });
    expect(parseRepositoryConfig("# just a comment")).toMatchObject({ valid: true, config: {} });
  });

  // The important half. A config file is written by a person and read by a machine that has to keep
  // reviewing their code either way.
  it("falls back to defaults and says why, rather than failing a review", () => {
    const result = parseRepositoryConfig("reviewProfile: shouty");
    expect(result.valid).toBe(false);
    expect(result.config.reviewProfile).toBeUndefined();
    expect(result.problems.join(" ")).toContain("reviewProfile");
  });

  it("keeps the settings it understood when one of them is wrong", () => {
    const result = parseRepositoryConfig("reviewProfile: quiet\nreviewTrigger: whenever");
    expect(result.valid).toBe(false);
    expect(result.config.reviewProfile).toBe("quiet");
    expect(result.config.reviewTrigger).toBeUndefined();
  });

  it("survives something that is not configuration at all", () => {
    for (const junk of [" ", "[[[", "a: b: c: d", "- 1\n- 2"]) {
      expect(() => parseRepositoryConfig(junk)).not.toThrow();
    }
  });

  it("bounds what a repository can ask for, because this text is attacker-controlled", () => {
    const many = ["pathFilters:", ...new Array(200).fill("  - '!x/**'")].join("\n");
    expect(parseRepositoryConfig(many).problems.join(" ")).toContain("pathFilters");

    const long = ["pathInstructions:", "  - path: 'a'", `    instructions: '${"x".repeat(5_000)}'`].join("\n");
    expect(parseRepositoryConfig(long).problems.join(" ")).toContain("pathInstructions");
  });
});
