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
  budget: BudgetSnapshot;
};
