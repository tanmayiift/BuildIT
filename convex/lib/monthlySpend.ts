// A running month-to-date spend total, kept on the organization row.
//
// preflightStageSpend used to answer "how much has this organization spent this month" by
// collecting every usageLedger row since the first of the month - once per model stage, so seven
// times per review, over a table that only grows. Correct, and a cliff: the cost of deciding
// whether to spend rose with the amount already spent.
//
// The month is stamped next to the total rather than reset by a schedule. A counter that depends
// on a cron to zero it carries last month's spend into this one whenever the cron is late, and
// that failure is silent and over-charges the customer. A stamp that no longer matches reads as
// zero on its own.

export type MonthlySpendState = { monthlySpendMicros?: number; monthlySpendMonth?: string };

export function monthKey(now: number) {
  const date = new Date(now);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Dollars, to match totalCostUsd, which is what the budget comparison takes.
export function spendThisMonth(state: MonthlySpendState, now: number) {
  if (state.monthlySpendMonth !== monthKey(now)) return 0;
  return (state.monthlySpendMicros ?? 0) / 1_000_000;
}

// Micros are integers all the way through: adding a float per stage accumulates rounding error
// across a month of additions, and this number decides whether a customer is allowed to spend.
export function addToMonth(state: MonthlySpendState, chargeMicros: number, now: number): Required<MonthlySpendState> {
  const month = monthKey(now), carried = state.monthlySpendMonth === month ? state.monthlySpendMicros ?? 0 : 0;
  return { monthlySpendMicros: carried + Math.round(chargeMicros), monthlySpendMonth: month };
}

