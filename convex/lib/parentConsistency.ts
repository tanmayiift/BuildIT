import { ConvexError } from "convex/values";
import type { GenericDatabaseReader } from "convex/server";
import type { DataModel, Id } from "../_generated/dataModel";

type Reader = GenericDatabaseReader<DataModel>;

function reject(): never {
  throw new ConvexError("parent_scope_mismatch");
}

export async function assertRepositoryParent(
  db: Reader,
  organizationId: Id<"organizations">,
  repositoryId: Id<"repositories">,
) {
  const repository = await db.get(repositoryId);
  if (!repository || repository.organizationId !== organizationId) reject();
  const installation = await db.get(repository.installationId);
  if (!installation || installation.organizationId !== organizationId) reject();
  return repository;
}

export async function assertReviewParent(
  db: Reader,
  organizationId: Id<"organizations">,
  reviewId: Id<"reviews">,
) {
  const review = await db.get(reviewId);
  if (!review || review.organizationId !== organizationId) reject();
  await assertRepositoryParent(db, organizationId, review.repositoryId);
  return review;
}

export async function assertAttemptParent(
  db: Reader,
  organizationId: Id<"organizations">,
  reviewId: Id<"reviews">,
  attemptId: Id<"autofixAttempts">,
) {
  await assertReviewParent(db, organizationId, reviewId);
  const attempt = await db.get(attemptId);
  if (!attempt || attempt.organizationId !== organizationId || attempt.reviewId !== reviewId) reject();
  return attempt;
}

export const parentConsistencyPolicies = {
  repositories: "organization_installation",
  configRevisions: "organization_repository_artifact",
  providerCredentials: "organization_optional_repository",
  trackerConnections: "organization_optional_repository",
  reviews: "organization_repository_config",
  reviewEvents: "organization_review_optional_artifact",
  modelStageRuns: "organization_repository_review",
  runState: "organization_repository_review",
  requirements: "organization_review_optional_artifact",
  findings: "organization_review_artifacts_requirement",
  findingSuppressions: "organization_repository",
  pullRequestPauses: "organization_repository",
  findingFeedback: "organization_repository_review",
  checkRuns: "organization_review_optional_round_artifact",
  baseResults: "organization_repository_config_optional_artifact",
  autofixAttempts: "organization_review_optional_artifact",
  autofixRounds: "organization_review_attempt",
  artifacts: "organization_repository_optional_review",
  usageLedger: "organization_repository_review_optional_round",
  githubSideEffects: "organization_repository_review",
  deliveries: "organization_review",
  evalCandidates: "organization_review",
  webhookDeliveries: "optional_review",
  notifications: "organization_optional_review",
  metricEvents: "organization_optional_repository_review_round",
  reviewLocks: "repository_review",
} as const;
