import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dynamicSetupSteps, isOptionalSetupStep, primarySetupSteps, setupSteps } from "./setup-steps";

// The same facts were maintained in three places and disagreed: route-map.ts knew six segments, the
// dynamic [step] route rendered four, and the stepper counted three. "Setup 1 of 3" was true of the
// counted path and said nothing about the other three routes a reader could be standing on. These
// assertions keep the three lists in a stated relationship rather than three independent opinions.
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("the setup route lists agree", () => {
  it("counts a path that is a subset of the routes that exist", () => {
    for (const step of primarySetupSteps) {
      expect(setupSteps, `${step.id} is counted but is not a route`).toContain(step.id);
    }
  });

  it("serves dynamic steps that are all real routes", () => {
    for (const step of dynamicSetupSteps) {
      expect(setupSteps, `${step} is rendered but is not a route`).toContain(step);
    }
  });

  it("accounts for every route as either counted or explicitly optional", () => {
    const unexplained = setupSteps.filter(step =>
      !primarySetupSteps.some(item => item.id === step) && !isOptionalSetupStep(step));
    expect(unexplained, "a setup route is either on the counted path or optional - never neither").toEqual([]);
    // And the optional ones are the ones a reader can reach but is not walked through.
    expect(setupSteps.filter(isOptionalSetupStep).sort()).toEqual(["health", "repository", "tracker"]);
  });

  it("is the only place the lists are written down", () => {
    const routeMap = read("../route-map.ts");
    const stepper = read("./setup/[step]/page.tsx");
    expect(routeMap, "route-map must import the list, not restate it").toContain('from "./app/setup-steps"');
    expect(routeMap).not.toMatch(/const setupSteps = \[/);
    expect(stepper, "the stepper must derive its count, not hardcode it").toContain("primarySetupSteps");
    expect(stepper).not.toMatch(/\{id:"install",label:"GitHub"\},\{id:"model"/);
  });

  it("numbers three steps, because each one costs the reader something", () => {
    // Not an arbitrary pin: the count is what the stepper renders, and a fourth counted step would
    // be a fourth thing asked of somebody who has not seen a result yet.
    expect(primarySetupSteps).toHaveLength(3);
  });
});
