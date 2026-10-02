// A per-tenant ceiling on sandbox time, so one workspace cannot consume the whole platform's
// sandbox quota.
//
// Sandbox seconds were already measured per organization and written to usageLedger at
// unitCost 0, and nothing ever read them back. The provider quota they draw on is finite,
// shared by every tenant on the deployment, and resets monthly - so the first workspace to run
// a lot of reviews took the capacity every other workspace needed, and the only signal was
// reviews failing with sandbox_unavailable for reasons that had nothing to do with them.
//
// Deliberately there is no "unlimited" setting. monthlyBudget and concurrencyLimit both treat 0
// as unset-and-therefore-unbounded, which is safe for them: they bound what a tenant spends on
// its own provider key, and how much of its own capacity it holds. This bounds a resource
// BuildIT buys once and shares, so an unset value falls back to the platform default rather
// than to no limit, and a non-positive override means the same thing.

export type SandboxCeilingState = {
  monthlySandboxSeconds?: number;
  sandboxSecondsUsed?: number;
  sandboxSecondsMonth?: string;
};

// Vercel's Hobby plan allows 5 hours of Sandbox Active CPU per month - 18,000 seconds - across
// every sandbox the deployment opens. This counter measures wall-clock seconds a tenant held a
// sandbox, which is always at least its active CPU, so the default is a conservative slice:
// five tenants each spending their whole default allowance stay inside the platform quota.
// Measured against four real reviews (12s, 26s, 72s, 159s of sandbox time), an hour is roughly
// fifty reviews a month.
export const platformMonthlySandboxSeconds = 18_000;
export const defaultMonthlySandboxSeconds = 3_600;

export function sandboxCeilingSeconds(state: Pick<SandboxCeilingState, "monthlySandboxSeconds">) {
  const configured = state.monthlySandboxSeconds;
  if (configured === undefined || !Number.isFinite(configured) || configured <= 0) return defaultMonthlySandboxSeconds;
  return Math.floor(configured);
}

// The month is stamped next to the total rather than zeroed by a schedule, for the reason
// monthlySpend.ts gives: a counter a cron has to reset carries last month's usage into this one
// whenever the cron is late, and that failure is silent and refuses work the tenant is owed.
export function sandboxSecondsThisMonth(state: SandboxCeilingState, month: string) {
  if (state.sandboxSecondsMonth !== month) return 0;
  const used = state.sandboxSecondsUsed;
  return Number.isFinite(used) && (used ?? 0) > 0 ? Math.floor(used!) : 0;
}

export function addSandboxSeconds(state: SandboxCeilingState, seconds: number, month: string) {
  const carried = state.sandboxSecondsMonth === month ? sandboxSecondsThisMonth(state, month) : 0;
  const added = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 0;
  return { sandboxSecondsUsed: carried + added, sandboxSecondsMonth: month };
}

// Admission-time comparison. A tenant at or over its ceiling starts nothing new; a tenant below
// it may start a review that then runs past the ceiling, bounded by concurrencyLimit times the
// longest a single job can hold a sandbox. That overshoot is the same shape the money budget
// accepts for reservations, and bounding it exactly would mean refusing reviews on a prediction
// of how long they will take, which nothing can honestly make.
export function sandboxCeilingExceeded(usedSeconds: number, ceilingSeconds: number) {
  if (!Number.isFinite(ceilingSeconds) || ceilingSeconds <= 0) return true;
  if (!Number.isFinite(usedSeconds)) return true;
  return usedSeconds >= ceilingSeconds;
}
