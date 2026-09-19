import { describe, expect, it } from "vitest";
import { publicDemoEnabled } from "./public-demo-gate";

describe("the open-scan demo gate", () => {
  // Same contract as the execution gate: exact "true", everything else off. The values listed here
  // are the ones an operator plausibly types by hand, and each of them meaning "off" is the point.
  it("fails closed unless the value is exactly true", () => {
    for (const value of [undefined, "", "false", "TRUE", "True", "1", "yes", "on"]) {
      expect(publicDemoEnabled(value), String(value)).toBe(false);
    }
    expect(publicDemoEnabled("true")).toBe(true);
  });
});
