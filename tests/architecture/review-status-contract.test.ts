import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { terminalStatuses } from "../../convex/lib/lifecycle";
import { nextActionCodes, nextActionPresentation, terminalReviewStatuses } from "../../apps/web/src/app/reviews/[id]/review-presentation";

const validators = readFileSync(fileURLToPath(new URL("../../convex/validators.ts", import.meta.url)), "utf8");

function unionLiterals(source: string, name: string) {
  const declaration = source.slice(source.indexOf(`export const ${name} = v.union(`));
  return [...declaration.slice(0, declaration.indexOf(");")).matchAll(/v\.literal\("([a-z_]+)"\)/g)].map(match => match[1]!);
}

describe("review status and next-action contracts", () => {
  // The UI previously hand-wrote a terminal list containing "passed" (never a real status) and
  // omitting "checks_passed" and "delivered", so a successful review offered a Cancel button
  // that could do nothing.
  it("the terminal set the review page uses matches the backend lifecycle", () => {
    expect([...terminalReviewStatuses].sort()).toEqual([...terminalStatuses].sort());
  });

  it("every terminal status is a declared review status", () => {
    const statuses = unionLiterals(validators, "reviewStatus");
    expect(statuses.length).toBeGreaterThan(0);
    for (const status of terminalReviewStatuses) expect(statuses).toContain(status);
  });

  // The next-action map previously overlapped the real enum in only 2 of 10 cases, so the
  // primary call to action rendered raw codes like "Reconnect provider".
  it("the next-action map covers exactly the declared nextActionCode union", () => {
    const declared = unionLiterals(validators, "nextActionCode");
    expect(declared.length).toBe(10);
    expect([...nextActionCodes].sort()).toEqual([...declared].sort());
  });

  it("gives every declared next action real guidance, never a humanised enum name", () => {
    for (const code of nextActionCodes) {
      const action = nextActionPresentation(code, false);
      expect(action.detail).not.toBe("Open the evidence below before taking action.");
      expect(action.title).not.toBe(code.replaceAll("_", " ").replace(/^./, first => first.toUpperCase()));
      expect(action.detail.length).toBeGreaterThan(20);
    }
  });

  // A user told to reconnect a provider or restore an installation cannot act from the
  // evidence panel; the action has to name where the fix lives.
  it("routes recoverable failures to the screen that fixes them", () => {
    for (const code of ["reconnect_provider", "restore_installation", "grant_permission"] as const) {
      expect(nextActionPresentation(code, false).href).toMatch(/^\//);
    }
  });

  it("a stale review always asks for a new run regardless of code", () => {
    expect(nextActionPresentation("none", true).title).toBe("Run a new review");
  });
});
