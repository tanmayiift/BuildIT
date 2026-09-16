import { describe, expect, it } from "vitest";
import { footerLinks } from "./[step]/page";

// The bug this exists to stop returning: the two footer links were derived by two nested
// ternaries that between them covered `install` and `model`. Every other step fell through both
// fallbacks to "/setup/review", so `repository` and `health` rendered two buttons with different
// labels and the same destination - and no way back to the step the reader arrived from.
describe("the setup footer", () => {
  it("never points both buttons at the same place", () => {
    for (const [step, links] of Object.entries(footerLinks)) {
      expect(links.next.href, `${step}: back and next differ`).not.toBe(links.back.href);
    }
  });

  it("gives every step a way backwards and a way onwards", () => {
    // Every step the wizard can render, not just the ones on the primary path. A step reachable
    // from the stepper or by URL and impossible to leave is the same defect in a different place.
    for (const step of ["install", "repository", "model", "health"]) {
      const links = footerLinks[step];
      expect(links, `${step} has footer links`).toBeDefined();
      for (const direction of ["back", "next"] as const) {
        expect(links![direction].href, `${step}.${direction} href`).toMatch(/^\/(setup\/[a-z]+)?$/);
        expect(links![direction].label.length, `${step}.${direction} label`).toBeGreaterThan(0);
      }
    }
  });
});
