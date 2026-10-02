import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The page claimed "no trial clock counting down" while three limits were enforced in code and named
// nowhere: a monthly model-spend ceiling, a concurrent-review cap, and a monthly sandbox allowance.
// All three refuse work. A pricing page that lists what is free and omits what stops you is accurate
// and incomplete, which on a page whose whole argument is auditability is the worse failure.
//
// They are described rather than quantified deliberately. The figures are per-workspace defaults an
// operator can change, so printing them would commit this page to numbers a future plan contradicts -
// the same staleness that rotted the track record for a month. /usage shows the live values.
const page = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

describe("what the pricing page admits", () => {
  it("names all three limits that can refuse a review", () => {
    expect(page).toMatch(/model spend/i);
    expect(page).toMatch(/how many reviews run at once|concurren/i);
    expect(page).toMatch(/sandbox time|sandbox allowance/i);
  });

  it("says each one refuses rather than overspending", () => {
    expect(page).toMatch(/refuses rather than overspends/i);
    expect(page).toMatch(/stops the next call rather than exceeding it/i);
  });

  it("explains that sandbox time is BuildIT's own capacity, not a charge on the customer's key", () => {
    // Otherwise await_sandbox_reset reads as a billing problem the reader could solve by paying.
    expect(page).toMatch(/BuildIT&apos;s own shared capacity|BuildIT's own shared capacity/);
    expect(page).toMatch(/not a charge on your key/i);
  });

  it("points at the page that holds the live values instead of printing figures", () => {
    expect(page).toMatch(/Usage page/);
    // No hardcoded limit figures: a number here is a commitment that goes stale.
    expect(page).not.toMatch(/\$\s?50\b/);
    expect(page).not.toMatch(/\b3,?600\s*(?:sandbox )?seconds\b/i);
    expect(page).not.toMatch(/\b3 concurrent\b/i);
  });

  it("still says what is free, so adding the limits did not turn the page defensive", () => {
    expect(page).toMatch(/no trial clock counting down/);
    expect(page).toMatch(/Every review is free/);
  });
});
