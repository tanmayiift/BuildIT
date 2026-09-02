import { reviewPromptStages, type PromptStage } from "./promptChain.js";

// The chain used to be fixed: every review ran all six stages in the same order, whatever the
// request looked like. That is a pipeline, not a manager. This plans the stages for one specific
// request and says why, so the plan is inspectable rather than implied.
//
// Every decision here is about what the request contains, never about what a model returned - a
// plan that a model could steer is a plan an attacker could steer.

export type ReviewPlan = {
  stages: readonly PromptStage[];
  skipped: Array<{ stage: PromptStage; because: string }>;
  findingsSpecialists: number;
  escalateUncertainAfter: number;
};

// Beyond this many changed files, one findings pass reads a diff too large to attend to evenly and
// the tail of the list gets less attention than the head.
export const largeDiffFiles = 40;
const maxFindingsSpecialists = 3;

// A critic that returns uncertain on the same finding twice is not going to become certain on a
// third pass; that is the point to involve a person rather than spend another call.
export const uncertainEscalationLimit = 2;

function fileCount(untrusted: Record<string, unknown>) {
  const files = untrusted.files;
  return Array.isArray(files) ? files.length : 0;
}

function hasRequirements(untrusted: Record<string, unknown>) {
  const pull = untrusted.pull as { requirements?: unknown } | undefined;
  const direct = untrusted.requirements;
  const fromPull = pull?.requirements;
  return (Array.isArray(direct) && direct.length > 0) || (Array.isArray(fromPull) && fromPull.length > 0);
}

export function planReview(untrusted: Record<string, unknown>): ReviewPlan {
  const skipped: ReviewPlan["skipped"] = [];
  const stages = reviewPromptStages.filter(stage => {
    // Asking a model to evaluate requirements nobody supplied invites it to invent them, and the
    // stage policy already says to return an empty array - so the call is spend for no evidence.
    if (stage === "requirements" && !hasRequirements(untrusted)) {
      skipped.push({ stage, because: "no canonical requirements were supplied with this pull request" });
      return false;
    }
    return true;
  });

  const files = fileCount(untrusted);
  const findingsSpecialists = files > largeDiffFiles
    ? Math.min(maxFindingsSpecialists, 1 + Math.floor(files / largeDiffFiles))
    : 1;

  return { stages, skipped, findingsSpecialists, escalateUncertainAfter: uncertainEscalationLimit };
}

// The findings stage is the one worth splitting: it is the only stage whose input grows with the
// diff. Each specialist gets a contiguous slice, so a finding's file is in exactly one of them and
// two specialists cannot both report it.
export function partitionFiles<T>(files: readonly T[], specialists: number): T[][] {
  if (specialists <= 1 || files.length === 0) return [[...files]];
  const size = Math.ceil(files.length / specialists);
  const slices: T[][] = [];
  for (let index = 0; index < files.length; index += size) slices.push(files.slice(index, index + size));
  return slices;
}

// Escalation is a property of the decision, not of a prompt: if the critic could not resolve a
// finding after the allowed passes, a person decides.
export function shouldEscalateToHuman(uncertainPasses: number, plan: ReviewPlan) {
  return uncertainPasses >= plan.escalateUncertainAfter;
}
