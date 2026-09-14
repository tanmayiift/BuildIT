# BuildIT route, function, job and package inventory — 2026-09-14

Generated from the current source. Search references identify relevant tests; they do not establish that a test ran or covers every branch. See FEATURE_TEST_MATRIX.md for measured outcomes and blockers.

## Web entry points

| Route pattern | Kind | Source |
| --- | --- | --- |
| /reviews | page | apps/web/src/app/reviews/page.tsx |
| /reviews/[id] | page | apps/web/src/app/reviews/[id]/page.tsx |
| /pricing | page | apps/web/src/app/pricing/page.tsx |
| / | page | apps/web/src/app/page.tsx |
| /history | page | apps/web/src/app/history/page.tsx |
| /proof | page | apps/web/src/app/proof/page.tsx |
| /sandbox | page | apps/web/src/app/sandbox/page.tsx |
| /account | page | apps/web/src/app/account/page.tsx |
| /setup/[step] | page | apps/web/src/app/setup/[step]/page.tsx |
| /setup/review | page | apps/web/src/app/setup/review/page.tsx |
| /data-handling | page | apps/web/src/app/data-handling/page.tsx |
| /[section] | page | apps/web/src/app/[section]/page.tsx |
| /sign-in | page | apps/web/src/app/sign-in/page.tsx |
| /features | page | apps/web/src/app/features/page.tsx |
| /setup/tracker | page | apps/web/src/app/setup/tracker/page.tsx |
| /api/github/webhooks | HTTP | apps/web/src/app/api/github/webhooks/route.ts |
| /api/scan | HTTP | apps/web/src/app/api/scan/route.ts |
| /api/health | HTTP | apps/web/src/app/api/health/route.ts |

Dynamic /[section] expands to the keys of workspace-sections.ts. /setup/[step] expands to its validated setup steps. /reviews/[id] has explicit sample and connected behavior. Auth library HTTP endpoints are registered through auth.addHttpRoutes(http).

## Broker HTTP endpoints

| Route | Source |
| --- | --- |
| /api/credentials | packages/broker/api/credentials.ts |
| /api/tracker-credentials | packages/broker/api/tracker-credentials.ts |
| /api/health | packages/broker/api/health.ts |
| /api/execute | packages/broker/api/execute.ts |
| /api/telemetry | packages/broker/api/telemetry.ts |
| /api/model | packages/broker/api/model.ts |
| /api/tracker | packages/broker/api/tracker.ts |
| /api/artifacts | packages/broker/api/artifacts.ts |
| /api/tracker-oauth | packages/broker/api/tracker-oauth.ts |

## Convex functions

Internal functions are not client-callable. Public role checks may delegate to another function; a blank direct role below is not a finding of missing authorization. publicFunctionPolicy.ts and tenantIsolation.test.ts define and exercise the actual boundaries.

| Function | Kind | Direct role literal | Tables directly queried/written | Test references |
| --- | --- | --- | --- | --- |
| notificationOutbox:fanout | internalMutation | delegated / see policy | memberships, notificationPreferences, notifications | convex/notificationOutbox.test.ts |
| notificationOutbox:start | internalMutation | delegated / see policy | notifications, emailBatches | convex/notificationOutbox.test.ts |
| notificationOutbox:prepare | internalMutation | delegated / see policy | delegated / none | convex/notificationOutbox.test.ts |
| notificationOutbox:finish | internalMutation | delegated / see policy | delegated / none | no direct reference; follow caller |
| notificationOutbox:purgeDeletedOrganization | internalMutation | delegated / see policy | notifications, notificationFanouts, emailBatches, notificationPreferences | convex/notificationOutbox.test.ts |
| reviewAutofixWorker:runConvergence | internalAction | delegated / see policy | delegated / none | no direct reference; follow caller |
| reviewAutofixWorker:deliverPassed | internalAction | delegated / see policy | delegated / none | no direct reference; follow caller |
| reviewAutofixWorker:publishFailure | internalAction | delegated / see policy | delegated / none | no direct reference; follow caller |
| githubInstallations:claim | action | delegated / see policy | delegated / none | no direct reference; follow caller |
| githubInstallations:syncRepositories | internalAction | delegated / see policy | delegated / none | no direct reference; follow caller |
| metrics:summarize | query | viewer | metricEvents | tests/e2e-local/workspaces.spec.ts<br>convex/tenantIsolation.test.ts<br>convex/workspaceSummaries.test.ts<br>apps/web/src/app/no-active-workspace.component.test.tsx<br>apps/web/src/app/live-metrics-usage.component.test.tsx |
| findings:dismiss | mutation | developer | findings, findingSuppressions, userProfiles | convex/historySummaries.test.ts<br>convex/connectedJourney.test.ts<br>tests/architecture/public-function-reachability.test.ts<br>apps/web/src/app/reviews/[id]/live-review-detail.component.test.tsx |
| dashboardReviews:prepare | action | delegated / see policy | delegated / none | convex/tenantIsolation.test.ts<br>apps/web/src/app/execution-readiness.component.test.tsx |
| dashboardReviews:start | action | delegated / see policy | delegated / none | no direct reference; follow caller |
| dashboardReviews:cancel | action | delegated / see policy | delegated / none | no direct reference; follow caller |
| runStateData:record | internalMutation | delegated / see policy | runState | no direct reference; follow caller |
| runStateData:forRun | internalQuery | delegated / see policy | runState | no direct reference; follow caller |
| reviews:list | query | viewer | reviews | convex/tenantIsolation.test.ts<br>convex/historySummaries.test.ts |
| reviews:get | query | viewer | delegated / none | convex/tenantIsolation.test.ts<br>convex/historySummaries.test.ts<br>convex/connectedJourney.test.ts<br>tests/architecture/public-function-reachability.test.ts<br>apps/web/src/app/reviews/[id]/live-review-detail.component.test.tsx<br>apps/web/src/app/reviews/[id]/review-presentation.test.ts |
| reviews:getEvidence | query | viewer | requirements, findings, checkRuns, autofixRounds, reviewEvents, modelStageRuns, usageLedger, runState | convex/tenantIsolation.test.ts<br>convex/historySummaries.test.ts<br>convex/connectedJourney.test.ts<br>tests/architecture/public-function-reachability.test.ts<br>apps/web/src/app/reviews/[id]/live-review-detail.component.test.tsx<br>apps/web/src/app/reviews/[id]/review-presentation.test.ts |
| reviews:runHistory | query | viewer | reviews, modelStageRuns, usageLedger, findings | convex/historySummaries.test.ts<br>convex/connectedJourney.test.ts<br>apps/web/src/app/reviews/[id]/live-review-detail.component.test.tsx |
| reviews:compareRuns | query | viewer | modelStageRuns, usageLedger, findings | convex/historySummaries.test.ts<br>convex/connectedJourney.test.ts<br>apps/web/src/app/reviews/[id]/live-review-detail.component.test.tsx |
| durableReview:assertActive | internalQuery | delegated / see policy | delegated / none | convex/tenantIsolation.test.ts<br>tests/architecture/autofix-cancellation-boundary.test.ts |
| durableReview:checkpoint | internalMutation | delegated / see policy | reviewEvents | convex/tenantIsolation.test.ts<br>convex/reviewLifecycleRecovery.test.ts<br>tests/architecture/durable-workflow.test.ts |
| durableReview:start | internalMutation | delegated / see policy | delegated / none | convex/tenantIsolation.test.ts<br>convex/accounting.test.ts |
| durableReview:publicationCompleted | internalMutation | delegated / see policy | reviewEvents | convex/reviewLifecycleRecovery.test.ts<br>tests/architecture/durable-workflow.test.ts |
| durableReview:fallbackOrReport | internalMutation | delegated / see policy | delegated / none | convex/accounting.test.ts<br>convex/reviewLifecycleRecovery.test.ts |
| durableReview:workflowCompleted | internalMutation | delegated / see policy | reviewEvents | convex/tenantIsolation.test.ts |
| durableReview:cancel | internalMutation | delegated / see policy | delegated / none | no direct reference; follow caller |
| durableReview:restart | internalMutation | delegated / see policy | delegated / none | no direct reference; follow caller |
| durableReview:workflowRuntimeStatus | internalQuery | delegated / see policy | delegated / none | no direct reference; follow caller |
| durableReview:reconcileStuck | internalMutation | delegated / see policy | reviews | no direct reference; follow caller |
| reviewAskData:askScope | internalQuery | delegated / see policy | reviews, providerCredentials, artifacts | convex/executionRecordIntegrity.test.ts |
| reviewAskData:recordAsk | internalMutation | delegated / see policy | usageLedger | convex/accounting.test.ts |
| audit:list | query | viewer | auditEvents | convex/tenantIsolation.test.ts<br>apps/web/src/app/no-active-workspace.component.test.tsx |
| audit:verifyChain | query | viewer | auditEvents | convex/tenantIsolation.test.ts<br>tests/architecture/public-function-reachability.test.ts |
| users:viewer | query | delegated / see policy | userProfiles | apps/web/src/app/account-status.component.test.tsx |
| users:installationIdentity | internalQuery | delegated / see policy | userProfiles | no direct reference; follow caller |
| users:sessions | query | delegated / see policy | authSessions | convex/tenantIsolation.test.ts |
| users:revokeOtherSessions | action | delegated / see policy | delegated / none | no direct reference; follow caller |
| repositoryConnections:current | query | delegated / see policy | userPreferences, memberships, githubInstallations, repositories, userProfiles | convex/tenantIsolation.test.ts<br>convex/connectedJourney.test.ts<br>tests/e2e/accessibility.spec.ts<br>apps/web/src/app/notification-preferences.component.test.tsx<br>apps/web/src/app/no-active-workspace.component.test.tsx<br>apps/web/src/app/execution-readiness.component.test.tsx<br>apps/web/src/app/model-key-form.component.test.tsx<br>apps/web/src/app/model-integration-state.component.test.tsx<br>apps/web/src/app/permission-receipt.component.test.tsx<br>apps/web/src/app/repository-connection-view.component.test.tsx<br>apps/web/src/app/tracker-connections.component.test.tsx<br>apps/web/src/app/live-metrics-usage.component.test.tsx |
| repositoryConnections:setReviewPolicy | mutation | admin | delegated / none | convex/policyReauthentication.test.ts |
| changelogWorker:record | internalAction | delegated / see policy | delegated / none | no direct reference; follow caller |
| permissionReceipts:current | query | delegated / see policy | userPreferences, userProfiles, memberships, githubInstallations, repositories, providerCredentials | convex/tenantIsolation.test.ts<br>apps/web/src/app/no-active-workspace.component.test.tsx<br>apps/web/src/app/permission-receipt.component.test.tsx |
| reviewHistory:summary | query | viewer | reviews, usageLedger, findings, findingFeedback | tests/e2e-local/workspaces.spec.ts<br>convex/historySummaries.test.ts |
| metricReconciliation:backfill | internalMutation | delegated / see policy | reviews, checkRuns, modelStageRuns, metricEvents | convex/workspaceSummaries.test.ts |
| trackerOAuth:availability | action | delegated / see policy | delegated / none | apps/web/src/app/tracker-oauth.component.test.tsx |
| trackerOAuth:begin | action | delegated / see policy | delegated / none | apps/web/src/app/tracker-oauth.component.test.tsx |
| trackerOAuth:complete | action | delegated / see policy | delegated / none | apps/web/src/app/tracker-oauth.component.test.tsx |
| trackerOAuth:projects | action | delegated / see policy | delegated / none | apps/web/src/app/tracker-oauth.component.test.tsx |
| trackerOAuth:connect | action | delegated / see policy | delegated / none | apps/web/src/app/tracker-oauth.component.test.tsx |
| trackerOAuth:disconnect | action | delegated / see policy | delegated / none | apps/web/src/app/tracker-oauth.component.test.tsx |
| trackerOAuth:refreshForReview | internalAction | delegated / see policy | delegated / none | no direct reference; follow caller |
| repositoryMemory:forRepository | internalQuery | delegated / see policy | delegated / none | convex/connectedJourney.test.ts |
| reviewAskWorker:answer | internalAction | delegated / see policy | delegated / none | convex/accounting.test.ts |
| reconcileWorker:sweep | internalMutation | delegated / see policy | webhookDeliveries, reviews | convex/tenantIsolation.test.ts<br>convex/webhookRetention.test.ts<br>convex/reviewLifecycleRecovery.test.ts |
| telemetryWorker:emit | internalAction | delegated / see policy | delegated / none | no direct reference; follow caller |
| automaticReviewData:automaticEligibility | internalQuery | delegated / see policy | repositories, pullRequestPauses, reviews | convex/automaticReview.test.ts |
| automaticReviewData:setPause | internalMutation | delegated / see policy | pullRequestPauses | convex/automaticReview.test.ts |
| automaticReviewData:setReviewTrigger | internalMutation | delegated / see policy | repositories | no direct reference; follow caller |
| automaticReviewData:setApprovedConfigHash | internalMutation | delegated / see policy | repositories | no direct reference; follow caller |
| automaticReviewData:recordPendingConfig | internalMutation | delegated / see policy | delegated / none | convex/configApproval.test.ts |
| integrations:listTrackerConnections | query | admin | trackerConnections | apps/web/src/app/tracker-connections.component.test.tsx |
| integrations:storeEncryptedTrackerConnection | mutation | admin | trackerConnections | no direct reference; follow caller |
| integrations:revokeTrackerConnection | mutation | admin | delegated / none | no direct reference; follow caller |
| integrations:listProviderCredentials | query | admin | providerCredentials | convex/tenantIsolation.test.ts<br>apps/web/src/app/model-integration-state.component.test.tsx |
| integrations:authorizeCredentialWrite | mutation | admin | credentialRateLimits | convex/tenantIsolation.test.ts |
| integrations:storeEncryptedCredential | mutation | admin | providerCredentials | convex/tenantIsolation.test.ts |
| integrations:revokeProviderCredential | mutation | admin | delegated / none | convex/tenantIsolation.test.ts |
| reviewCommandData:commandScope | internalQuery | delegated / see policy | delegated / none | no direct reference; follow caller |
| usage:prepare | mutation | viewer | delegated / none | tests/e2e-local/workspaces.spec.ts<br>convex/workspaceSummaries.test.ts |
| usage:summarize | query | viewer | usageLedger | tests/e2e-local/workspaces.spec.ts<br>convex/tenantIsolation.test.ts<br>convex/workspaceSummaries.test.ts<br>apps/web/src/app/no-active-workspace.component.test.tsx<br>apps/web/src/app/live-metrics-usage.component.test.tsx |
| notificationWorker:captureBatch | internalAction | delegated / see policy | delegated / none | convex/notificationOutbox.test.ts |
| artifactCleanupData:claimExpired | internalMutation | delegated / see policy | artifacts | convex/tenantIsolation.test.ts<br>convex/artifactErasure.test.ts |
| artifactCleanupData:eraseReviewEvidence | internalMutation | delegated / see policy | artifacts | convex/artifactErasure.test.ts |
| artifactCleanupData:completeDeletion | internalMutation | delegated / see policy | delegated / none | convex/tenantIsolation.test.ts |
| artifactCleanupData:failDeletion | internalMutation | delegated / see policy | delegated / none | convex/tenantIsolation.test.ts |
| artifactCleanupData:listTerminal | internalQuery | delegated / see policy | artifacts | convex/tenantIsolation.test.ts |
| artifactCleanupData:retryTerminal | internalMutation | delegated / see policy | delegated / none | convex/tenantIsolation.test.ts |
| reviewEvidenceActions:getFindingDetails | action | delegated / see policy | delegated / none | apps/web/src/app/reviews/[id]/live-review-detail.component.test.tsx |
| telemetrySnapshotData:snapshot | internalQuery | delegated / see policy | reviews, organizations, artifacts, usageLedger, metricEvents | no direct reference; follow caller |
| modelAccounting:reconcile | internalMutation | delegated / see policy | delegated / none | convex/accounting.test.ts |
| modelAccounting:snapshot | internalQuery | delegated / see policy | delegated / none | tests/e2e-local/workspaces.spec.ts<br>convex/accounting.test.ts |
| modelAccounting:reviewSnapshot | internalQuery | delegated / see policy | delegated / none | convex/accounting.test.ts |
| modelAccounting:reserve | internalMutation | delegated / see policy | modelInvocations, reviewEvents, usageLedger | tests/e2e-local/workspaces.spec.ts<br>convex/accounting.test.ts<br>convex/askRateLimit.test.ts |
| modelAccounting:settle | internalMutation | delegated / see policy | delegated / none | tests/e2e-local/workspaces.spec.ts<br>convex/accounting.test.ts |
| findingFeedbackData:record | internalMutation | delegated / see policy | findings | convex/historySummaries.test.ts |
| findingFeedbackData:feedbackForRepository | internalQuery | delegated / see policy | findingFeedback | no direct reference; follow caller |
| findingFeedbackData:repositoryByGithubId | internalQuery | delegated / see policy | repositories | no direct reference; follow caller |
| findingFeedbackData:recordByIndex | internalMutation | delegated / see policy | reviews, findings | convex/historySummaries.test.ts |
| telemetrySnapshotWorker:emit | internalAction | delegated / see policy | delegated / none | no direct reference; follow caller |
| reviewReportWorker:compose | internalAction | delegated / see policy | delegated / none | no direct reference; follow caller |
| memberships:list | query | viewer | memberships, userProfiles | no direct reference; follow caller |
| memberships:invite | mutation | admin | memberships | convex/tenantIsolation.test.ts<br>tests/architecture/public-function-reachability.test.ts |
| memberships:inviteByGitHubLogin | mutation | admin | userProfiles, memberships | convex/tenantIsolation.test.ts<br>tests/architecture/public-function-reachability.test.ts |
| memberships:listInvitations | query | delegated / see policy | memberships | no direct reference; follow caller |
| memberships:accept | mutation | delegated / see policy | memberships, userPreferences | convex/tenantIsolation.test.ts<br>tests/architecture/public-function-reachability.test.ts |
| memberships:changeRole | mutation | admin | delegated / none | convex/tenantIsolation.test.ts |
| memberships:remove | mutation | admin | delegated / none | no direct reference; follow caller |
| githubInstallationsData:attachInstallation | internalMutation | delegated / see policy | organizations, memberships, githubInstallations, userPreferences | convex/tenantIsolation.test.ts |
| githubInstallationsData:syncInstallationRepositories | internalMutation | delegated / see policy | githubInstallations | convex/repositorySync.test.ts |
| activation:funnel | query | viewer | memberships, repositories, providerCredentials, reviews, auditEvents, reviewEvents | convex/tenantIsolation.test.ts<br>convex/historySummaries.test.ts<br>tests/architecture/query-bounds.test.ts |
| reviewCommandWorker:respond | internalAction | delegated / see policy | delegated / none | no direct reference; follow caller |
| reviewArtifactData:contextScope | internalQuery | delegated / see policy | trackerConnections | convex/trackerOAuth.test.ts |
| reviewArtifactData:markTrackerUsed | internalMutation | delegated / see policy | delegated / none | no direct reference; follow caller |
| reviewArtifactData:reserve | internalMutation | delegated / see policy | artifacts | convex/tenantIsolation.test.ts |
| reviewArtifactData:complete | internalMutation | delegated / see policy | delegated / none | convex/tenantIsolation.test.ts |
| organizations:listMine | query | delegated / see policy | memberships | convex/tenantIsolation.test.ts |
| organizations:active | query | delegated / see policy | userPreferences, memberships | convex/tenantIsolation.test.ts |
| organizations:selectActive | mutation | viewer | userPreferences | convex/tenantIsolation.test.ts |
| organizations:clearActive | mutation | delegated / see policy | userPreferences | tests/architecture/public-function-reachability.test.ts |
| organizations:updateCapacity | mutation | owner | delegated / none | tests/e2e-local/workspaces.spec.ts<br>convex/tenantIsolation.test.ts<br>tests/architecture/public-function-reachability.test.ts |
| organizations:setCapacityLimits | internalMutation | delegated / see policy | delegated / none | convex/tenantIsolation.test.ts |
| githubWebhookProcessor:processWebhook | internalAction | delegated / see policy | delegated / none | no direct reference; follow caller |
| githubWebhookProcessor:processPullRequestWebhook | internalAction | delegated / see policy | delegated / none | no direct reference; follow caller |
| githubWebhookProcessor:processPushWebhook | internalAction | delegated / see policy | delegated / none | no direct reference; follow caller |
| trackerOAuthData:authorize | internalQuery | delegated / see policy | delegated / none | no direct reference; follow caller |
| trackerOAuthData:prepare | internalMutation | delegated / see policy | trackerOAuthStates | convex/trackerOAuth.test.ts |
| trackerOAuthData:consume | internalMutation | delegated / see policy | trackerOAuthStates | convex/trackerOAuth.test.ts |
| trackerOAuthData:saveDraft | internalMutation | delegated / see policy | delegated / none | convex/trackerOAuth.test.ts |
| trackerOAuthData:getDraft | internalQuery | delegated / see policy | delegated / none | no direct reference; follow caller |
| trackerOAuthData:pending | query | delegated / see policy | trackerOAuthStates | convex/trackerOAuth.test.ts<br>apps/web/src/app/tracker-oauth.component.test.tsx |
| trackerOAuthData:finish | internalMutation | delegated / see policy | trackerConnections | convex/trackerOAuth.test.ts |
| trackerOAuthData:fail | internalMutation | delegated / see policy | delegated / none | convex/trackerOAuth.test.ts |
| trackerOAuthData:expire | internalMutation | delegated / see policy | delegated / none | convex/trackerOAuth.test.ts |
| trackerOAuthData:disconnect | internalMutation | delegated / see policy | delegated / none | convex/trackerOAuth.test.ts |
| trackerOAuthData:claimRefresh | internalMutation | delegated / see policy | delegated / none | convex/trackerOAuth.test.ts |
| trackerOAuthData:finishRefresh | internalMutation | delegated / see policy | delegated / none | convex/trackerOAuth.test.ts |
| trackerOAuthData:failRefresh | internalMutation | delegated / see policy | delegated / none | convex/trackerOAuth.test.ts |
| trackerOAuthData:purgeOrganization | internalMutation | delegated / see policy | trackerOAuthStates, trackerConnections | convex/trackerOAuth.test.ts |
| trackerOAuthData:sweepDeletedOrganizations | internalMutation | delegated / see policy | organizations | convex/trackerOAuth.test.ts |
| publicProof:summary | query | delegated / see policy | reviews, findings, usageLedger | convex/publicProof.test.ts<br>convex/historySummaries.test.ts<br>tests/e2e/onboarding.spec.ts<br>apps/web/src/app/proof/page.component.test.tsx |
| publicProof:recentPublicReviews | query | delegated / see policy | repositories, reviews | convex/historySummaries.test.ts<br>apps/web/src/app/proof/page.component.test.tsx |
| reviewAnalysisWorker:analyze | internalAction | delegated / see policy | delegated / none | tests/architecture/durable-workflow.test.ts |
| notifications:preferences | query | viewer | notificationPreferences | convex/notifications.test.ts<br>convex/notificationOutbox.test.ts<br>apps/web/src/app/no-active-workspace.component.test.tsx |
| notifications:updatePreferences | mutation | viewer | notificationPreferences | convex/notifications.test.ts<br>convex/notificationOutbox.test.ts<br>tests/architecture/public-function-reachability.test.ts |
| notifications:resolveDecisionRecipient | internalQuery | delegated / see policy | delegated / none | convex/notifications.test.ts |
| reviewPublicationWorker:publish | internalAction | delegated / see policy | delegated / none | tests/architecture/durable-workflow.test.ts |
| reviewPublicationWorker:publishPlatformFailure | internalAction | delegated / see policy | delegated / none | tests/architecture/durable-workflow.test.ts |
| reviewPublicationWorker:acknowledge | internalAction | delegated / see policy | delegated / none | convex/tenantIsolation.test.ts |
| reviewContextWorker:gather | internalAction | delegated / see policy | delegated / none | tests/architecture/durable-workflow.test.ts |
| artifacts:getMetadata | query | viewer | delegated / none | convex/tenantIsolation.test.ts<br>tests/architecture/public-function-reachability.test.ts |
| dashboardReviewData:scope | internalQuery | developer | providerCredentials | no direct reference; follow caller |
| dashboardReviewData:availableProviders | query | developer | providerCredentials | convex/tenantIsolation.test.ts<br>apps/web/src/app/execution-readiness.component.test.tsx |
| dashboardReviewData:cancellationScope | internalQuery | developer | delegated / none | convex/tenantIsolation.test.ts |
| dashboardReviewData:create | internalMutation | delegated / see policy | memberships, reviews, configRevisions, providerCredentials, reviewLocks, reviewEvents | convex/tenantIsolation.test.ts |
| dashboardReviewData:recordPreview | internalMutation | delegated / see policy | memberships, auditEvents | convex/tenantIsolation.test.ts |
| changelogData:changelogScope | internalQuery | delegated / see policy | repositories, reviews, findings | no direct reference; follow caller |
| reviewValidationWorker:validate | internalAction | delegated / see policy | delegated / none | tests/architecture/durable-workflow.test.ts |
| reviewState:baseAdvance | internalQuery | delegated / see policy | delegated / none | convex/reviewLifecycleRecovery.test.ts |
| reviewState:transition | internalMutation | delegated / see policy | delegated / none | convex/tenantIsolation.test.ts<br>convex/workspaceSummaries.test.ts<br>convex/notificationOutbox.test.ts |
| reviewState:markStale | internalMutation | delegated / see policy | delegated / none | convex/tenantIsolation.test.ts<br>convex/workspaceSummaries.test.ts |
| reviewState:appendEvent | internalMutation | delegated / see policy | reviewEvents | convex/tenantIsolation.test.ts |
| reviewState:acquireLease | internalMutation | delegated / see policy | delegated / none | convex/tenantIsolation.test.ts |
| reviewState:requestCancellation | internalMutation | delegated / see policy | delegated / none | convex/tenantIsolation.test.ts<br>convex/reviewLifecycleRecovery.test.ts |
| reviewState:expireBlocked | internalMutation | delegated / see policy | delegated / none | no direct reference; follow caller |
| reviewState:claimActiveReview | internalMutation | delegated / see policy | reviewLocks | convex/tenantIsolation.test.ts |
| reviewState:reserveSideEffect | internalMutation | delegated / see policy | githubSideEffects | convex/tenantIsolation.test.ts<br>tests/architecture/autofix-side-effect-keys.test.ts |
| reviewState:recordAutofixAttempt | internalMutation | delegated / see policy | autofixAttempts | convex/tenantIsolation.test.ts |
| reviewState:recordAutofixRound | internalMutation | delegated / see policy | autofixRounds | convex/tenantIsolation.test.ts |
| reviewModelData:recordStageRun | internalMutation | delegated / see policy | modelStageRuns, usageLedger | convex/tenantIsolation.test.ts<br>convex/accounting.test.ts<br>convex/executionRecordIntegrity.test.ts |
| reviewModelData:recordProviderRetry | internalMutation | delegated / see policy | delegated / none | no direct reference; follow caller |
| reviewModelData:preflightStageSpend | internalMutation | delegated / see policy | reviewEvents | convex/tenantIsolation.test.ts<br>convex/accounting.test.ts |
| reviewModelData:analysisScope | internalQuery | delegated / see policy | artifacts, providerCredentials | convex/tenantIsolation.test.ts |
| reviewModelData:reserveOutput | internalMutation | delegated / see policy | artifacts | convex/tenantIsolation.test.ts |
| reviewModelData:completeAnalysis | internalMutation | delegated / see policy | requirements, findings | convex/tenantIsolation.test.ts |
| reviewPublicationData:publicationScope | internalQuery | delegated / see policy | artifacts, reviewEvents | no direct reference; follow caller |
| reviewPublicationData:platformFailureScope | internalQuery | delegated / see policy | providerCredentials | no direct reference; follow caller |
| reviewPublicationData:completeSideEffect | internalMutation | delegated / see policy | delegated / none | convex/tenantIsolation.test.ts |
| artifactCleanupWorker:cleanup | internalAction | delegated / see policy | delegated / none | convex/tenantIsolation.test.ts |
| artifactCleanupWorker:sweepTerminal | internalAction | delegated / see policy | delegated / none | convex/tenantIsolation.test.ts |
| runtimeReadiness:current | query | delegated / see policy | delegated / none | convex/runtimeReadiness.test.ts<br>tests/architecture/execution-release-gate.test.ts<br>apps/web/src/app/execution-readiness.component.test.tsx<br>apps/web/src/app/setup/first-review.component.test.tsx |
| findingFeedbackWorker:observe | internalAction | delegated / see policy | delegated / none | no direct reference; follow caller |
| findingFeedbackWorker:dismissByIndex | internalAction | delegated / see policy | delegated / none | no direct reference; follow caller |
| reviewAutofixData:mode | internalQuery | delegated / see policy | delegated / none | no direct reference; follow caller |
| reviewAutofixData:assertActive | internalQuery | delegated / see policy | delegated / none | convex/tenantIsolation.test.ts |
| reviewAutofixData:scope | internalQuery | delegated / see policy | artifacts, autofixRounds, autofixAttempts, providerCredentials | no direct reference; follow caller |
| reviewAutofixData:reserveArtifact | internalMutation | delegated / see policy | artifacts | no direct reference; follow caller |
| reviewAutofixData:completeArtifact | internalMutation | delegated / see policy | delegated / none | no direct reference; follow caller |
| reviewAutofixData:completeRound | internalMutation | delegated / see policy | autofixRounds, autofixAttempts, checkRuns | convex/tenantIsolation.test.ts |
| reviewAutofixData:completeDelivery | internalMutation | delegated / see policy | autofixRounds, checkRuns, githubSideEffects, reviewEvents, metricEvents | convex/tenantIsolation.test.ts |
| reviewAutofixData:completeFailure | internalMutation | delegated / see policy | autofixRounds, githubSideEffects, reviewEvents | no direct reference; follow caller |
| reviewAutofixData:failPlatform | internalMutation | delegated / see policy | delegated / none | convex/reviewLifecycleRecovery.test.ts |
| reviewValidationData:validationScope | internalQuery | delegated / see policy | artifacts | no direct reference; follow caller |
| reviewValidationData:reserveOutput | internalMutation | delegated / see policy | artifacts | no direct reference; follow caller |
| reviewValidationData:completeValidation | internalMutation | delegated / see policy | checkRuns, baseResults, usageLedger | convex/tenantIsolation.test.ts<br>convex/workspaceSummaries.test.ts |
| reviewValidationData:finalizeDecision | internalMutation | delegated / see policy | checkRuns, findings, reviewEvents | convex/tenantIsolation.test.ts |
| reviewEvidenceData:findingDetailScope | internalQuery | viewer | artifacts | convex/tenantIsolation.test.ts |
| githubWebhookData:reserve | internalMutation | delegated / see policy | webhookDeliveries | convex/tenantIsolation.test.ts |
| githubWebhookData:scope | internalQuery | delegated / see policy | githubInstallations, repositories | convex/tenantIsolation.test.ts |
| githubWebhookData:cancellationTargets | internalQuery | delegated / see policy | reviews | convex/tenantIsolation.test.ts |
| githubWebhookData:recordPinnedSnapshot | internalMutation | delegated / see policy | webhookDeliveries | convex/tenantIsolation.test.ts |
| githubWebhookData:materializeReview | internalMutation | delegated / see policy | webhookDeliveries, reviews, configRevisions, providerCredentials, reviewLocks, reviewEvents | convex/tenantIsolation.test.ts |
| githubWebhookData:complete | internalMutation | delegated / see policy | webhookDeliveries | convex/tenantIsolation.test.ts |
| githubWebhookData:reconcilePullRequestHead | internalMutation | delegated / see policy | githubInstallations, repositories, reviews | convex/tenantIsolation.test.ts |
| githubWebhookData:reconcileDefaultBranchPush | internalMutation | delegated / see policy | githubInstallations, repositories | convex/tenantIsolation.test.ts |
| evalLoop:recordMissedVerdict | internalMutation | delegated / see policy | evalCandidates | convex/connectedJourney.test.ts |
| evalLoop:recordDismissedFinding | internalMutation | delegated / see policy | evalCandidates | no direct reference; follow caller |
| evalLoop:pendingCandidates | internalQuery | delegated / see policy | evalCandidates | convex/connectedJourney.test.ts |
| evalLoop:markCurated | internalMutation | delegated / see policy | delegated / none | convex/connectedJourney.test.ts |
| reviewReportData:reportScope | internalQuery | delegated / see policy | artifacts, usageLedger | no direct reference; follow caller |
| reviewReportData:reserveOutput | internalMutation | delegated / see policy | artifacts | no direct reference; follow caller |
| reviewReportData:completeOutput | internalMutation | delegated / see policy | delegated / none | no direct reference; follow caller |

## Scheduled intervals

| Job | Interval | Handler |
| --- | --- | --- |
| delete expired encrypted artifacts | {minutes:15} | artifactCleanupWorker.cleanup |
| requeue stuck artifact deletions | {hours:1} | artifactCleanupWorker.sweepTerminal |
| reconcile stuck and expired reviews | {minutes:10} | reconcileWorker.sweep |
| emit source-free operational snapshot | {minutes:5} | telemetrySnapshotWorker.emit |
| purge deleted workspace connection metadata | {hours:1} | trackerOAuthData.sweepDeletedOrganizations |

Actions also schedule bounded retries, workflow steps, cleanup, accounting reconciliation, OAuth expiry and local email batches. These are not additional cron intervals.

## Packages

| Package | File | Available package scripts |
| --- | --- | --- |
| @buildit/orchestrator | packages/orchestrator/package.json | build, typecheck, lint |
| @buildit/cli | apps/cli/package.json | build, typecheck, lint |
| @buildit/core | packages/core/package.json | build, typecheck, lint |
| @buildit/runner | packages/runner/package.json | build, typecheck, smoke:sandbox, lint |
| @buildit/contracts | packages/contracts/package.json | build, typecheck, lint |
| @buildit/security | packages/security/package.json | build, typecheck, lint |
| @buildit/github | packages/github/package.json | build, typecheck, lint |
| @buildit/providers | packages/providers/package.json | build, typecheck, lint |
| @buildit/scanners | packages/scanners/package.json | build, typecheck, lint |
| @buildit/telemetry | packages/telemetry/package.json | build, typecheck, lint |
| @buildit/operations | packages/operations/package.json | build, typecheck, lint |
| @buildit/web | apps/web/package.json | dev, prebuild, build, typecheck, lint |
| @buildit/evaluations | packages/evaluations/package.json | build, typecheck, lint |
| @buildit/broker | packages/broker/package.json | build, typecheck, lint |

## Counts

Discovered 613 files across the scoped application/package/backend/test/script/infrastructure directories, 203 exported Convex procedures, 18 web entry patterns, 9 broker routes, 5 cron intervals and 225 test files. These counts describe discoverability, not complete behavioral coverage.
