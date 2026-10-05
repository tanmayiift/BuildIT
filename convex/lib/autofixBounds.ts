// What a bounded stop is, as distinct from an outage.
//
// Everything runConvergence threw that was not a safe decline reached failPlatform, which ran it
// through classifyPlatformFailure. None of the bound codes match any pattern there, so all of them
// became `platform_error`: the author was told "a required platform step failed - retry once the
// service is available" when what actually happened was BuildIT's own loop guard stopping a model
// that proposed the same patch twice, or the wall clock running out.
//
// Retrying an outage is sensible. Retrying a bound spends money to hit the identical wall, which is
// why telling them apart matters more than the wording. The proof this was never reachable: three
// of the four `terminationBound` values in validators.ts had no writer anywhere.
//
// `autofix_spend_limit` is deliberately not a bound. It is the same event modelAccounting records
// as `budget_exhausted` with `increase_budget`, and routing it here instead would give one cause
// two different answers depending on which code path noticed first.

export type AutofixStop =
  | { kind: "bound"; terminationBound: "round_limit" | "attempt_limit" | "wall_clock_limit" | "repeated_patch" | undefined; statusReasonCode: "final_validation_incomplete" }
  | { kind: "budget" }
  | { kind: "platform" };

const bounds: Record<string, "round_limit" | "attempt_limit" | "wall_clock_limit" | "repeated_patch"> = {
  autofix_round_limit: "round_limit",
  autofix_attempt_limit: "attempt_limit",
  autofix_time_limit: "wall_clock_limit",
  autofix_repeated_patch: "repeated_patch",
};

// The code a worker threw, as the workflow hands it back: "Uncaught Error: <code>\n    at handler
// (...)". Both classifiers here were written against bare codes and tested with bare codes, so in
// production neither ever matched - a repeated patch and a worsened candidate were reported as
// platform failures exactly as they were before these classifiers existed.
export function workflowErrorCode(message: string) {
  return message.match(/(?:^|Error:\s*)([a-z][a-z0-9_]*)/)?.[1] ?? message.trim();
}

export function classifyAutofixStop(raw: string): AutofixStop {
  const code = workflowErrorCode(raw);
  if (code === "autofix_spend_limit") return { kind: "budget" };
  const bound = bounds[code];
  if (bound) return { kind: "bound", terminationBound: bound, statusReasonCode: "final_validation_incomplete" };
  // candidateWorsened is a bounded refusal too - BuildIT declining to deliver a patch that made
  // things worse - but it is not one of the four named bounds, so it records none rather than
  // borrowing one that would misdescribe it.
  if (code.startsWith("autofix_worsened")) return { kind: "bound", terminationBound: undefined, statusReasonCode: "final_validation_incomplete" };
  return { kind: "platform" };
}
