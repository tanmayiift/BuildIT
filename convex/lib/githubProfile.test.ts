import { describe, expect, it } from "vitest";
import { normalizeGitHubProfile } from "./githubProfile";

describe("GitHub OAuth profile normalization", () => {
  it("omits a private null email while preserving the immutable GitHub identity", () => {
    expect(normalizeGitHubProfile({ id: 42, login: "rohan", name: null, email: null, avatar_url: "https://avatars.example/42" })).toEqual({
      id: "42", githubUserId: 42, login: "rohan", name: "rohan", image: "https://avatars.example/42",
    });
  });
  it("keeps a returned email and display name", () => expect(normalizeGitHubProfile({ id: "42", login: "rohan", name: "Rohan", email: "r@example.com" })).toMatchObject({ email: "r@example.com", name: "Rohan" }));
  it("rejects incomplete or unsafe identities", () => {
    expect(() => normalizeGitHubProfile({ id: "not-a-number", login: "rohan" })).toThrow("github_identity_incomplete");
    expect(() => normalizeGitHubProfile({ id: 42, login: "" })).toThrow("github_identity_incomplete");
  });
});
