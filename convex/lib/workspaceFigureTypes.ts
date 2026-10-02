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
  // platformUsedSeconds/platformCeilingSeconds are the deployment's shared total, not this
  // workspace's. A workspace well inside its own allowance can still be refused on the shared one,
  // and without both figures the page cannot tell the reader which limit is in the way.
  sandbox: { usedSeconds: number; ceilingSeconds: number; platformUsedSeconds: number; platformCeilingSeconds: number };
  budget: BudgetSnapshot;
};
