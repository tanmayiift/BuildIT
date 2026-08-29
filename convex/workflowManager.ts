import { WorkflowManager } from "@convex-dev/workflow";
import { Workpool } from "@convex-dev/workpool";
import { components } from "./_generated/api";

export const reviewWorkflowManager = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    maxParallelism: 4,
    retryActionsByDefault: false,
    defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 1_000, base: 2 },
  },
});

export const reviewWorkpool = new Workpool(components.reviewWorkpool, {
  maxParallelism: 4,
  retryActionsByDefault: false,
  defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 1_000, base: 2 },
});
