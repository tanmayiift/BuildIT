/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activation from "../activation.js";
import type * as artifactCleanupData from "../artifactCleanupData.js";
import type * as artifactCleanupWorker from "../artifactCleanupWorker.js";
import type * as artifacts from "../artifacts.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as automaticReviewData from "../automaticReviewData.js";
import type * as crons from "../crons.js";
import type * as dashboardReviewData from "../dashboardReviewData.js";
import type * as dashboardReviews from "../dashboardReviews.js";
import type * as dataClassification from "../dataClassification.js";
import type * as durableReview from "../durableReview.js";
import type * as evalLoop from "../evalLoop.js";
import type * as findings from "../findings.js";
import type * as githubInstallations from "../githubInstallations.js";
import type * as githubInstallationsData from "../githubInstallationsData.js";
import type * as githubWebhookData from "../githubWebhookData.js";
import type * as githubWebhookProcessor from "../githubWebhookProcessor.js";
import type * as http from "../http.js";
import type * as integrations from "../integrations.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_coverageGate from "../lib/coverageGate.js";
import type * as lib_credentialRevocation from "../lib/credentialRevocation.js";
import type * as lib_durableStages from "../lib/durableStages.js";
import type * as lib_executionGate from "../lib/executionGate.js";
import type * as lib_githubProfile from "../lib/githubProfile.js";
import type * as lib_lifecycle from "../lib/lifecycle.js";
import type * as lib_monthlySpend from "../lib/monthlySpend.js";
import type * as lib_parentConsistency from "../lib/parentConsistency.js";
import type * as lib_parentScope from "../lib/parentScope.js";
import type * as lib_platformFailureReport from "../lib/platformFailureReport.js";
import type * as lib_providerFallback from "../lib/providerFallback.js";
import type * as lib_providerRetry from "../lib/providerRetry.js";
import type * as lib_runtimeVersion from "../lib/runtimeVersion.js";
import type * as lib_tenantLimits from "../lib/tenantLimits.js";
import type * as lib_usageCost from "../lib/usageCost.js";
import type * as lib_validationEvidence from "../lib/validationEvidence.js";
import type * as lib_webhookSignature from "../lib/webhookSignature.js";
import type * as memberships from "../memberships.js";
import type * as metrics from "../metrics.js";
import type * as notifications from "../notifications.js";
import type * as organizations from "../organizations.js";
import type * as permissionReceipts from "../permissionReceipts.js";
import type * as publicFunctionPolicy from "../publicFunctionPolicy.js";
import type * as reconcileWorker from "../reconcileWorker.js";
import type * as repositoryConnections from "../repositoryConnections.js";
import type * as repositoryMemory from "../repositoryMemory.js";
import type * as reviewAnalysisWorker from "../reviewAnalysisWorker.js";
import type * as reviewArtifactData from "../reviewArtifactData.js";
import type * as reviewAskData from "../reviewAskData.js";
import type * as reviewAskWorker from "../reviewAskWorker.js";
import type * as reviewAutofixData from "../reviewAutofixData.js";
import type * as reviewAutofixWorker from "../reviewAutofixWorker.js";
import type * as reviewCommandData from "../reviewCommandData.js";
import type * as reviewCommandWorker from "../reviewCommandWorker.js";
import type * as reviewContextWorker from "../reviewContextWorker.js";
import type * as reviewEvidenceActions from "../reviewEvidenceActions.js";
import type * as reviewEvidenceData from "../reviewEvidenceData.js";
import type * as reviewModelData from "../reviewModelData.js";
import type * as reviewPublicationData from "../reviewPublicationData.js";
import type * as reviewPublicationWorker from "../reviewPublicationWorker.js";
import type * as reviewReportData from "../reviewReportData.js";
import type * as reviewReportWorker from "../reviewReportWorker.js";
import type * as reviewState from "../reviewState.js";
import type * as reviewValidationData from "../reviewValidationData.js";
import type * as reviewValidationWorker from "../reviewValidationWorker.js";
import type * as reviews from "../reviews.js";
import type * as runtimeReadiness from "../runtimeReadiness.js";
import type * as tablePolicy from "../tablePolicy.js";
import type * as telemetrySnapshotData from "../telemetrySnapshotData.js";
import type * as telemetrySnapshotWorker from "../telemetrySnapshotWorker.js";
import type * as telemetryWorker from "../telemetryWorker.js";
import type * as usage from "../usage.js";
import type * as users from "../users.js";
import type * as validators from "../validators.js";
import type * as workflowManager from "../workflowManager.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activation: typeof activation;
  artifactCleanupData: typeof artifactCleanupData;
  artifactCleanupWorker: typeof artifactCleanupWorker;
  artifacts: typeof artifacts;
  audit: typeof audit;
  auth: typeof auth;
  automaticReviewData: typeof automaticReviewData;
  crons: typeof crons;
  dashboardReviewData: typeof dashboardReviewData;
  dashboardReviews: typeof dashboardReviews;
  dataClassification: typeof dataClassification;
  durableReview: typeof durableReview;
  evalLoop: typeof evalLoop;
  findings: typeof findings;
  githubInstallations: typeof githubInstallations;
  githubInstallationsData: typeof githubInstallationsData;
  githubWebhookData: typeof githubWebhookData;
  githubWebhookProcessor: typeof githubWebhookProcessor;
  http: typeof http;
  integrations: typeof integrations;
  "lib/audit": typeof lib_audit;
  "lib/authz": typeof lib_authz;
  "lib/coverageGate": typeof lib_coverageGate;
  "lib/credentialRevocation": typeof lib_credentialRevocation;
  "lib/durableStages": typeof lib_durableStages;
  "lib/executionGate": typeof lib_executionGate;
  "lib/githubProfile": typeof lib_githubProfile;
  "lib/lifecycle": typeof lib_lifecycle;
  "lib/monthlySpend": typeof lib_monthlySpend;
  "lib/parentConsistency": typeof lib_parentConsistency;
  "lib/parentScope": typeof lib_parentScope;
  "lib/platformFailureReport": typeof lib_platformFailureReport;
  "lib/providerFallback": typeof lib_providerFallback;
  "lib/providerRetry": typeof lib_providerRetry;
  "lib/runtimeVersion": typeof lib_runtimeVersion;
  "lib/tenantLimits": typeof lib_tenantLimits;
  "lib/usageCost": typeof lib_usageCost;
  "lib/validationEvidence": typeof lib_validationEvidence;
  "lib/webhookSignature": typeof lib_webhookSignature;
  memberships: typeof memberships;
  metrics: typeof metrics;
  notifications: typeof notifications;
  organizations: typeof organizations;
  permissionReceipts: typeof permissionReceipts;
  publicFunctionPolicy: typeof publicFunctionPolicy;
  reconcileWorker: typeof reconcileWorker;
  repositoryConnections: typeof repositoryConnections;
  repositoryMemory: typeof repositoryMemory;
  reviewAnalysisWorker: typeof reviewAnalysisWorker;
  reviewArtifactData: typeof reviewArtifactData;
  reviewAskData: typeof reviewAskData;
  reviewAskWorker: typeof reviewAskWorker;
  reviewAutofixData: typeof reviewAutofixData;
  reviewAutofixWorker: typeof reviewAutofixWorker;
  reviewCommandData: typeof reviewCommandData;
  reviewCommandWorker: typeof reviewCommandWorker;
  reviewContextWorker: typeof reviewContextWorker;
  reviewEvidenceActions: typeof reviewEvidenceActions;
  reviewEvidenceData: typeof reviewEvidenceData;
  reviewModelData: typeof reviewModelData;
  reviewPublicationData: typeof reviewPublicationData;
  reviewPublicationWorker: typeof reviewPublicationWorker;
  reviewReportData: typeof reviewReportData;
  reviewReportWorker: typeof reviewReportWorker;
  reviewState: typeof reviewState;
  reviewValidationData: typeof reviewValidationData;
  reviewValidationWorker: typeof reviewValidationWorker;
  reviews: typeof reviews;
  runtimeReadiness: typeof runtimeReadiness;
  tablePolicy: typeof tablePolicy;
  telemetrySnapshotData: typeof telemetrySnapshotData;
  telemetrySnapshotWorker: typeof telemetrySnapshotWorker;
  telemetryWorker: typeof telemetryWorker;
  usage: typeof usage;
  users: typeof users;
  validators: typeof validators;
  workflowManager: typeof workflowManager;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  reviewWorkpool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"reviewWorkpool">;
};
