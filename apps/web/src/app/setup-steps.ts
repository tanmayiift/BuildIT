// One list of the setup routes, for the reason workspace-sections.ts gives about itself: the same
// facts were maintained in three places and disagreed. route-map.ts knew six segments, the dynamic
// [step] route rendered four, and the stepper counted three - so "Setup 1 of 3" was true of the
// counted path and said nothing about the other three routes a reader could be standing on.
//
// The three lists are different things and all three are legitimate. Naming them here makes the
// relationship explicit and lets a test assert it, instead of leaving a reader to infer which of the
// three numbers describes where they are.

/** Every route under /setup that exists. route-map.ts derives the Edge proxy's segments from this. */
export const setupSteps = ["install", "repository", "model", "health", "tracker", "review"] as const;

/** The counted path - what the stepper numbers, and the only sequence a first-time reader is walked
 *  through. Three steps, each of which costs the reader something. */
export const primarySetupSteps = [
  { id: "install", label: "GitHub" },
  { id: "model", label: "Model key" },
  { id: "review", label: "Your pull request" },
] as const;

/** Served by the dynamic [step] route. `review` and `tracker` are their own static routes. */
export const dynamicSetupSteps = ["install", "repository", "model", "health"] as const;

/** Reachable, and deliberately off the counted path - so a page must say so rather than imply it is
 *  step N of 3. */
export function isOptionalSetupStep(step: string) {
  return (setupSteps as readonly string[]).includes(step)
    && !primarySetupSteps.some(item => item.id === step);
}
