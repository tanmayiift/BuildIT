import type { MutationCtx, QueryCtx } from "../_generated/server";
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

// The sandbox time BuildIT allows itself in a month, across every sandbox the deployment opens.
//
// On Vercel Hobby this was the provider's whole quota, 5 hours (18,000 seconds), and past it every
// review on every account failed until the reset: about 80 reviews a month for the entire platform.
// The team moved to Pro on 6 Oct 2026, where Sandbox Active CPU is metered (about $0.13 an hour) rather
// than capped, so this is now BuildIT's own spend guard: 50 hours of sandbox time, which at the
// sandbox's 2 vCPUs is at most about $13 of CPU a month. Raise it deliberately, not by accident.
//
// This counter measures wall-clock seconds a tenant held a sandbox, which is always at least its
// active CPU. Measured against four real reviews (12s, 26s, 72s, 159s of sandbox time), an hour is
// roughly fifty reviews a month.
export const platformMonthlySandboxSeconds = 180_000;
export const defaultMonthlySandboxSeconds = 3_600;

// Dividing the quota into per-tenant slices only bounds the platform while the number of tenants
// times the default stays inside it: at 3,600 seconds each, the fifty-first workspace puts the
// deployment over 180,000 with every tenant still inside its own ceiling. So the platform needs its
// own counter, and the per-tenant ceiling is a fairness rule rather than the thing that protects
// the quota.
//
// It trips at 90% rather than at the quota, because the last tenth is the difference between BuildIT
// refusing and the provider refusing. A provider-side refusal arrives as sandbox_unavailable with no
// explanation and no reset date; this one can say what happened and when it clears. The reserve also
// covers what this counter cannot see - idle sandbox time after a worker abandons a job - and the
// gap between the wall-clock seconds measured here and the Active CPU seconds the provider bills.
export const platformSandboxReserveFraction = 0.1;
export const platformUsableMonthlySandboxSeconds =
  Math.floor(platformMonthlySandboxSeconds * (1 - platformSandboxReserveFraction));

export function platformCeilingExceeded(usedSeconds: number, ceilingSeconds = platformUsableMonthlySandboxSeconds) {
  if (!Number.isFinite(ceilingSeconds) || ceilingSeconds <= 0) return true;
  if (!Number.isFinite(usedSeconds)) return true;
  return usedSeconds >= ceilingSeconds;
}

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

// The platform row is read on every admission and written on every checkpoint, so it is a single
// month-keyed row rather than a sum over tenants: summing would make the cost of deciding whether
// to run a review grow with the number of workspaces, which is the unbounded-read defect this
// codebase has had to remove from this exact path twice.
export async function platformSandboxSecondsThisMonth(ctx: QueryCtx, month: string) {
  const row = await ctx.db.query("platformSandboxUsage").withIndex("by_month", q => q.eq("month", month)).unique();
  const used = row?.usedSeconds;
  return Number.isFinite(used) && (used ?? 0) > 0 ? Math.floor(used!) : 0;
}

export async function addPlatformSandboxSeconds(ctx: MutationCtx, seconds: number, month: string, now: number) {
  const added = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 0;
  if (added === 0) return;
  const row = await ctx.db.query("platformSandboxUsage").withIndex("by_month", q => q.eq("month", month)).unique();
  if (!row) {
    await ctx.db.insert("platformSandboxUsage", { month, usedSeconds: added, updatedAt: now });
    return;
  }
  const carried = Number.isFinite(row.usedSeconds) && row.usedSeconds > 0 ? Math.floor(row.usedSeconds) : 0;
  await ctx.db.patch(row._id, { usedSeconds: carried + added, updatedAt: now });
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
