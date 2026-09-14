import { describe, expect, it } from "vitest";
import { cancellationNotice } from "./lifecycle";

describe("cancellation receipts do not invent billing evidence", () => {
  it("does not promise an expired blocked review had never started or spent", () => {
    const notice = cancellationNotice({ headSha: "a".repeat(40), reasonCode: "blocked_expired" });
    expect(notice.summary).not.toContain("never started");
    expect(notice.summary).not.toContain("nothing was charged");
    expect(notice.title).not.toContain("before it could start");
  });
});
