// Wire types shared with the web client. Keep this module free of server imports so the web
// compiler does not typecheck Convex implementation files with the web app's compiler settings.
export type BudgetSnapshot = {
  month: string;
  periodStart: number;
  periodEnd: number;
  estimatedSpendUsd: number;
  reservedUsd: number;
  monthlyBudgetUsd: number;
  remainingUsd: number | null;
  accountingComplete: boolean;
  reconciliationComplete: boolean;
  unknownInvocationCount: number;
  legacyCostsMayBeIncomplete: boolean;
};

export type WorkspaceMetricsSummary = {
  totals: Record<string, number>;
  recordCount: number;
  truncated: boolean;
  since: number;
  trackingSince: number | null;
  incompleteNames: string[];
};

export type WorkspaceUsageSummary = {
  quantities: Record<string, number>;
  costs: Record<string, number>;
  recordCount: number;
  truncated: boolean;
  since: number;
  monthlyBudget: number;
  // The monthly sandbox allowance and how much of it this workspace has used. Separate from
  // quantities.sandbox_seconds, which counts only validation-command time inside the ledger
  // window: this is the figure the admission check compares against, so it is the one that
  // explains a refusal.
  sandbox: { usedSeconds: number; ceilingSeconds: number };
  budget: BudgetSnapshot;
};
