import { describe, expect, it } from "vitest";
import { sameRepositoryIssueNumber } from "./reviewContextWorker";

describe("review requirement link scope", () => {
  it("accepts only an exact same-repository GitHub issue URL", () => {
    const repository = "https://github.com/acme/api";
    expect(sameRepositoryIssueNumber("https://github.com/acme/api/issues/42", repository)).toBe(42);
    for (const url of ["https://github.com/acme/other/issues/42", "https://github.com.evil.test/acme/api/issues/42", "http://github.com/acme/api/issues/42", "https://github.com/acme/api/pull/42", "https://github.com/acme/api/issues/42?x=1", "https://github.com/acme/api/issues/0"]) expect(sameRepositoryIssueNumber(url, repository)).toBeUndefined();
  });
});
