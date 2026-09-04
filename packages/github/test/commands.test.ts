import { describe, expect, it } from "vitest";
import { authorizeTrigger } from "../src/index.js";

// A user had no way to learn that `@buildit ask` exists. The commands were documented in a web
// page nobody reads while looking at a pull request, which is where the commands are typed.
//
// And there was no way to say "stop reviewing this one". A pull request that is a work in
// progress, or a generated bump, gets a full review on every push, and the only remedy was to
// disconnect the whole repository - so people disconnect the whole repository.

const base = { deliveryId: "d1", senderType: "User", action: "created", permission: "triage" as const };

describe("discovering what BuildIT can do", () => {
  it("answers help at read permission, because it reveals nothing about the code", () => {
    expect(authorizeTrigger({ ...base, permission: "read", body: "@buildit help" }))
      .toMatchObject({ accepted: true, kind: "help" });
  });

  it("still refuses a bot, which would otherwise answer itself forever", () => {
    expect(authorizeTrigger({ ...base, senderType: "Bot", body: "@buildit help" }))
      .toMatchObject({ accepted: false, reason: "bot" });
  });
});

describe("pausing automatic reviews on one pull request", () => {
  it("takes write permission, because it changes what happens on the next push", () => {
    expect(authorizeTrigger({ ...base, permission: "triage", body: "@buildit pause" }))
      .toMatchObject({ accepted: false, reason: "permission" });
    expect(authorizeTrigger({ ...base, permission: "write", body: "@buildit pause" }))
      .toMatchObject({ accepted: true, kind: "pause" });
  });

  it("resumes at the same permission that paused it", () => {
    expect(authorizeTrigger({ ...base, permission: "write", body: "@buildit resume" }))
      .toMatchObject({ accepted: true, kind: "resume" });
  });

  it("takes no flags, so a typo is refused rather than half-understood", () => {
    expect(authorizeTrigger({ ...base, permission: "write", body: "@buildit pause stacked" }))
      .toMatchObject({ accepted: false });
  });
});

describe("the commands that already worked", () => {
  it("are unchanged", () => {
    expect(authorizeTrigger({ ...base, body: "@buildit review" })).toMatchObject({ accepted: true, kind: "review" });
    expect(authorizeTrigger({ ...base, permission: "write", body: "@buildit autofix stacked" })).toMatchObject({ accepted: true, kind: "autofix", mode: "stacked" });
    expect(authorizeTrigger({ ...base, permission: "write", body: "@buildit cancel" })).toMatchObject({ accepted: true, kind: "cancel" });
    expect(authorizeTrigger({ ...base, body: "@buildit ask why?" })).toMatchObject({ accepted: true, kind: "ask", question: "why?" });
  });
});
