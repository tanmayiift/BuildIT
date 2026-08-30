/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as artifacts from "../artifacts.js";
import type * as auth from "../auth.js";
import type * as dataClassification from "../dataClassification.js";
import type * as durableReview from "../durableReview.js";
import type * as githubInstallations from "../githubInstallations.js";
import type * as githubInstallationsData from "../githubInstallationsData.js";
import type * as githubWebhookData from "../githubWebhookData.js";
import type * as githubWebhookProcessor from "../githubWebhookProcessor.js";
import type * as http from "../http.js";
import type * as integrations from "../integrations.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_durableStages from "../lib/durableStages.js";
import type * as lib_githubProfile from "../lib/githubProfile.js";
import type * as lib_lifecycle from "../lib/lifecycle.js";
import type * as lib_parentConsistency from "../lib/parentConsistency.js";
import type * as memberships from "../memberships.js";
import type * as metrics from "../metrics.js";
import type * as organizations from "../organizations.js";
import type * as publicFunctionPolicy from "../publicFunctionPolicy.js";
import type * as repositoryConnections from "../repositoryConnections.js";
import type * as reviewState from "../reviewState.js";
import type * as reviews from "../reviews.js";
import type * as tablePolicy from "../tablePolicy.js";
import type * as users from "../users.js";
import type * as validators from "../validators.js";
import type * as workflowManager from "../workflowManager.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  artifacts: typeof artifacts;
  auth: typeof auth;
  dataClassification: typeof dataClassification;
  durableReview: typeof durableReview;
  githubInstallations: typeof githubInstallations;
  githubInstallationsData: typeof githubInstallationsData;
  githubWebhookData: typeof githubWebhookData;
  githubWebhookProcessor: typeof githubWebhookProcessor;
  http: typeof http;
  integrations: typeof integrations;
  "lib/audit": typeof lib_audit;
  "lib/authz": typeof lib_authz;
  "lib/durableStages": typeof lib_durableStages;
  "lib/githubProfile": typeof lib_githubProfile;
  "lib/lifecycle": typeof lib_lifecycle;
  "lib/parentConsistency": typeof lib_parentConsistency;
  memberships: typeof memberships;
  metrics: typeof metrics;
  organizations: typeof organizations;
  publicFunctionPolicy: typeof publicFunctionPolicy;
  repositoryConnections: typeof repositoryConnections;
  reviewState: typeof reviewState;
  reviews: typeof reviews;
  tablePolicy: typeof tablePolicy;
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
