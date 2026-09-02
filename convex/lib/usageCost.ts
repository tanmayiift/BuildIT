// usageLedger stored a derived unit price - cost / max(1, quantity) - and every reader multiplied
// it back by quantity. When a provider omits usage the quantity is 0, so the multiplication
// returns 0 and the real cost of that call disappears from spend, budgets and telemetry: the
// exact case where a call is most likely to have been expensive and unaccounted for.
//
// The total is now stored directly, in integer micro-dollars so repeated addition does not drift.
export const microsPerDollar = 1_000_000;

export function toMicros(costUsd: number) {
  if (!Number.isFinite(costUsd) || costUsd < 0) return 0;
  return Math.round(costUsd * microsPerDollar);
}

export type LedgerCost = { quantity: number; unitCost: number; totalCostMicros?: number };

// Rows written before totalCostMicros existed still reconstruct from the unit price. Those rows
// carry the original defect, so a zero-quantity one reads as zero either way - there is nothing
// recorded to recover.
export function rowCostUsd(row: LedgerCost) {
  if (typeof row.totalCostMicros === "number" && Number.isFinite(row.totalCostMicros)) return row.totalCostMicros / microsPerDollar;
  return row.quantity * row.unitCost;
}

export function totalCostUsd(rows: LedgerCost[]) {
  return rows.reduce((sum, row) => sum + rowCostUsd(row), 0);
}
