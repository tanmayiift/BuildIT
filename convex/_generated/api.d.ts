/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accountingSchema from "../accountingSchema.js";
import type * as activation from "../activation.js";
import type * as artifactCleanupData from "../artifactCleanupData.js";
import type * as artifactCleanupWorker from "../artifactCleanupWorker.js";
import type * as artifacts from "../artifacts.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as automaticReviewData from "../automaticReviewData.js";
import type * as changelogData from "../changelogData.js";
import type * as changelogWorker from "../changelogWorker.js";
import type * as crons from "../crons.js";
import type * as dashboardReviewData from "../dashboardReviewData.js";
import type * as dashboardReviews from "../dashboardReviews.js";
import type * as dataClassification from "../dataClassification.js";
import type * as durableReview from "../durableReview.js";
import type * as evalLoop from "../evalLoop.js";
import type * as executionJobsData from "../executionJobsData.js";
import type * as findingFeedbackData from "../findingFeedbackData.js";
import type * as findingFeedbackWorker from "../findingFeedbackWorker.js";
import type * as findings from "../findings.js";
import type * as githubInstallations from "../githubInstallations.js";
import type * as githubInstallationsData from "../githubInstallationsData.js";
import type * as githubWebhookData from "../githubWebhookData.js";
import type * as githubWebhookProcessor from "../githubWebhookProcessor.js";
import type * as http from "../http.js";
import type * as integrations from "../integrations.js";
import type * as lib_accountedModel from "../lib/accountedModel.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_blockingFindings from "../lib/blockingFindings.js";
import type * as lib_budgetAccounting from "../lib/budgetAccounting.js";
import type * as lib_coverageGate from "../lib/coverageGate.js";
import type * as lib_credentialRevocation from "../lib/credentialRevocation.js";
import type * as lib_durableStages from "../lib/durableStages.js";
import type * as lib_executionGate from "../lib/executionGate.js";
import type * as lib_executionSegmentDriver from "../lib/executionSegmentDriver.js";
import type * as lib_findingOpinions from "../lib/findingOpinions.js";
import type * as lib_findingResolution from "../lib/findingResolution.js";
import type * as lib_githubProfile from "../lib/githubProfile.js";
import type * as lib_lifecycle from "../lib/lifecycle.js";
import type * as lib_monthlySpend from "../lib/monthlySpend.js";
import type * as lib_notificationRecipient from "../lib/notificationRecipient.js";
import type * as lib_parentConsistency from "../lib/parentConsistency.js";
import type * as lib_parentScope from "../lib/parentScope.js";
import type * as lib_platformFailureReport from "../lib/platformFailureReport.js";
import type * as lib_providerFallback from "../lib/providerFallback.js";
import type * as lib_providerRetry from "../lib/providerRetry.js";
import type * as lib_queueNotification from "../lib/queueNotification.js";
import type * as lib_recordMetric from "../lib/recordMetric.js";
import type * as lib_reportingPeriod from "../lib/reportingPeriod.js";
import type * as lib_reviewOutcome from "../lib/reviewOutcome.js";
import type * as lib_runIdentity from "../lib/runIdentity.js";
import type * as lib_runtimeVersion from "../lib/runtimeVersion.js";
import type * as lib_tenantLimits from "../lib/tenantLimits.js";
import type * as lib_trackerCredential from "../lib/trackerCredential.js";
import type * as lib_usageCost from "../lib/usageCost.js";
import type * as lib_validationEvidence from "../lib/validationEvidence.js";
import type * as lib_webhookSignature from "../lib/webhookSignature.js";
import type * as lib_workspaceFigureTypes from "../lib/workspaceFigureTypes.js";
import type * as memberships from "../memberships.js";
import type * as metricReconciliation from "../metricReconciliation.js";
import type * as metrics from "../metrics.js";
import type * as modelAccounting from "../modelAccounting.js";
import type * as modelProbe from "../modelProbe.js";
import type * as modelProbeData from "../modelProbeData.js";
import type * as notificationOutbox from "../notificationOutbox.js";
import type * as notificationSchema from "../notificationSchema.js";
import type * as notificationWorker from "../notificationWorker.js";
import type * as notifications from "../notifications.js";
import type * as organizations from "../organizations.js";
import type * as permissionReceipts from "../permissionReceipts.js";
import type * as publicFunctionPolicy from "../publicFunctionPolicy.js";
import type * as publicProof from "../publicProof.js";
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
import type * as reviewHistory from "../reviewHistory.js";
import type * as reviewModelData from "../reviewModelData.js";
import type * as reviewPublicationData from "../reviewPublicationData.js";
import type * as reviewPublicationWorker from "../reviewPublicationWorker.js";
import type * as reviewReportData from "../reviewReportData.js";
import type * as reviewReportWorker from "../reviewReportWorker.js";
import type * as reviewState from "../reviewState.js";
import type * as reviewValidationData from "../reviewValidationData.js";
import type * as reviewValidationWorker from "../reviewValidationWorker.js";
import type * as reviews from "../reviews.js";
import type * as runStateData from "../runStateData.js";
import type * as runtimeReadiness from "../runtimeReadiness.js";
import type * as sandboxReclaimWorker from "../sandboxReclaimWorker.js";
import type * as tablePolicy from "../tablePolicy.js";
import type * as telemetrySnapshotData from "../telemetrySnapshotData.js";
import type * as telemetrySnapshotWorker from "../telemetrySnapshotWorker.js";
import type * as telemetryWorker from "../telemetryWorker.js";
import type * as testing_summaryFixture from "../testing/summaryFixture.js";
import type * as trackerOAuth from "../trackerOAuth.js";
import type * as trackerOAuthData from "../trackerOAuthData.js";
import type * as trackerOAuthSchema from "../trackerOAuthSchema.js";
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
  accountingSchema: typeof accountingSchema;
  activation: typeof activation;
  artifactCleanupData: typeof artifactCleanupData;
  artifactCleanupWorker: typeof artifactCleanupWorker;
  artifacts: typeof artifacts;
  audit: typeof audit;
  auth: typeof auth;
  automaticReviewData: typeof automaticReviewData;
  changelogData: typeof changelogData;
  changelogWorker: typeof changelogWorker;
  crons: typeof crons;
  dashboardReviewData: typeof dashboardReviewData;
  dashboardReviews: typeof dashboardReviews;
  dataClassification: typeof dataClassification;
  durableReview: typeof durableReview;
  evalLoop: typeof evalLoop;
  executionJobsData: typeof executionJobsData;
  findingFeedbackData: typeof findingFeedbackData;
  findingFeedbackWorker: typeof findingFeedbackWorker;
  findings: typeof findings;
  githubInstallations: typeof githubInstallations;
  githubInstallationsData: typeof githubInstallationsData;
  githubWebhookData: typeof githubWebhookData;
  githubWebhookProcessor: typeof githubWebhookProcessor;
  http: typeof http;
  integrations: typeof integrations;
  "lib/accountedModel": typeof lib_accountedModel;
  "lib/audit": typeof lib_audit;
  "lib/authz": typeof lib_authz;
  "lib/blockingFindings": typeof lib_blockingFindings;
  "lib/budgetAccounting": typeof lib_budgetAccounting;
  "lib/coverageGate": typeof lib_coverageGate;
  "lib/credentialRevocation": typeof lib_credentialRevocation;
  "lib/durableStages": typeof lib_durableStages;
  "lib/executionGate": typeof lib_executionGate;
  "lib/executionSegmentDriver": typeof lib_executionSegmentDriver;
  "lib/findingOpinions": typeof lib_findingOpinions;
  "lib/findingResolution": typeof lib_findingResolution;
  "lib/githubProfile": typeof lib_githubProfile;
  "lib/lifecycle": typeof lib_lifecycle;
  "lib/monthlySpend": typeof lib_monthlySpend;
  "lib/notificationRecipient": typeof lib_notificationRecipient;
  "lib/parentConsistency": typeof lib_parentConsistency;
  "lib/parentScope": typeof lib_parentScope;
  "lib/platformFailureReport": typeof lib_platformFailureReport;
  "lib/providerFallback": typeof lib_providerFallback;
  "lib/providerRetry": typeof lib_providerRetry;
  "lib/queueNotification": typeof lib_queueNotification;
  "lib/recordMetric": typeof lib_recordMetric;
  "lib/reportingPeriod": typeof lib_reportingPeriod;
  "lib/reviewOutcome": typeof lib_reviewOutcome;
  "lib/runIdentity": typeof lib_runIdentity;
  "lib/runtimeVersion": typeof lib_runtimeVersion;
  "lib/tenantLimits": typeof lib_tenantLimits;
  "lib/trackerCredential": typeof lib_trackerCredential;
  "lib/usageCost": typeof lib_usageCost;
  "lib/validationEvidence": typeof lib_validationEvidence;
  "lib/webhookSignature": typeof lib_webhookSignature;
  "lib/workspaceFigureTypes": typeof lib_workspaceFigureTypes;
  memberships: typeof memberships;
  metricReconciliation: typeof metricReconciliation;
  metrics: typeof metrics;
  modelAccounting: typeof modelAccounting;
  modelProbe: typeof modelProbe;
  modelProbeData: typeof modelProbeData;
  notificationOutbox: typeof notificationOutbox;
  notificationSchema: typeof notificationSchema;
  notificationWorker: typeof notificationWorker;
  notifications: typeof notifications;
  organizations: typeof organizations;
  permissionReceipts: typeof permissionReceipts;
  publicFunctionPolicy: typeof publicFunctionPolicy;
  publicProof: typeof publicProof;
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
  reviewHistory: typeof reviewHistory;
  reviewModelData: typeof reviewModelData;
  reviewPublicationData: typeof reviewPublicationData;
  reviewPublicationWorker: typeof reviewPublicationWorker;
  reviewReportData: typeof reviewReportData;
  reviewReportWorker: typeof reviewReportWorker;
  reviewState: typeof reviewState;
  reviewValidationData: typeof reviewValidationData;
  reviewValidationWorker: typeof reviewValidationWorker;
  reviews: typeof reviews;
  runStateData: typeof runStateData;
  runtimeReadiness: typeof runtimeReadiness;
  sandboxReclaimWorker: typeof sandboxReclaimWorker;
  tablePolicy: typeof tablePolicy;
  telemetrySnapshotData: typeof telemetrySnapshotData;
  telemetrySnapshotWorker: typeof telemetrySnapshotWorker;
  telemetryWorker: typeof telemetryWorker;
  "testing/summaryFixture": typeof testing_summaryFixture;
  trackerOAuth: typeof trackerOAuth;
  trackerOAuthData: typeof trackerOAuthData;
  trackerOAuthSchema: typeof trackerOAuthSchema;
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
