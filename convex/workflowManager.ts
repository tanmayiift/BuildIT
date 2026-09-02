import { WorkflowManager } from "@convex-dev/workflow";
import { Workpool } from "@convex-dev/workpool";
import { components } from "./_generated/api";

// Retries are safe because every stage is idempotent: each side effect is reserved before it is
// performed and completed after, and assertActive fences on head SHA and execution generation, so
// a replayed action cannot double-publish or act on a superseded commit.
export const reviewWorkflowManager = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    maxParallelism: 4,
    retryActionsByDefault: true,
    defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 1_000, base: 2 },
  },
});

export const reviewWorkpool = new Workpool(components.reviewWorkpool, {
  maxParallelism: 4,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 1_000, base: 2 },
});
