export type AuthorizationPolicy =
  | "public_webhook"
  | "authenticated_user"
  | "active_organization_viewer"
  | "active_organization_developer"
  | "active_organization_admin"
  | "active_organization_admin_recent_auth"
  | "active_organization_owner_recent_auth"
  | "invited_user";

export type ResponseClassification = "none" | "metadata" | "personal_identity" | "authorized_source_derived";

export const publicFunctionPolicies = {
  "activation:funnel": { authorization: "active_organization_viewer", response: "metadata" },
  "audit:list": { authorization: "active_organization_viewer", response: "metadata" },
  "audit:verifyChain": { authorization: "active_organization_viewer", response: "metadata" },
  "findings:dismiss": { authorization: "active_organization_developer", response: "metadata" },
  "reviews:runHistory": { authorization: "active_organization_viewer", response: "metadata" },
  "reviews:compareRuns": { authorization: "active_organization_viewer", response: "metadata" },
  "organizations:updateCapacity": { authorization: "active_organization_owner_recent_auth", response: "metadata" },
  "artifacts:getMetadata": { authorization: "active_organization_viewer", response: "metadata" },
  "dashboardReviewData:availableProviders": { authorization: "active_organization_developer", response: "metadata" },
  "dashboardReviews:prepare": { authorization: "active_organization_developer", response: "metadata" },
  "dashboardReviews:cancel": { authorization: "active_organization_developer", response: "metadata" },
  "dashboardReviews:start": { authorization: "active_organization_developer", response: "metadata" },
  "githubInstallations:claim": { authorization: "authenticated_user", response: "metadata" },
  "integrations:listProviderCredentials": { authorization: "active_organization_admin", response: "metadata" },
  "integrations:listTrackerConnections": { authorization: "active_organization_admin", response: "metadata" },
  "integrations:storeEncryptedTrackerConnection": { authorization: "active_organization_admin", response: "metadata" },
  "integrations:revokeTrackerConnection": { authorization: "active_organization_admin_recent_auth", response: "metadata" },
  "integrations:authorizeCredentialWrite": { authorization: "active_organization_admin_recent_auth", response: "metadata" },
  "integrations:storeEncryptedCredential": { authorization: "active_organization_admin_recent_auth", response: "metadata" },
  "integrations:revokeProviderCredential": { authorization: "active_organization_admin_recent_auth", response: "metadata" },
  "memberships:list": { authorization: "active_organization_viewer", response: "metadata" },
  "memberships:invite": { authorization: "active_organization_admin_recent_auth", response: "metadata" },
  "memberships:inviteByGitHubLogin": { authorization: "active_organization_admin_recent_auth", response: "metadata" },
  "memberships:accept": { authorization: "invited_user", response: "metadata" },
  "memberships:changeRole": { authorization: "active_organization_admin_recent_auth", response: "none" },
  "memberships:remove": { authorization: "active_organization_admin_recent_auth", response: "none" },
  "metrics:summarize": { authorization: "active_organization_viewer", response: "metadata" },
  "reviewHistory:summary": { authorization: "active_organization_viewer", response: "metadata" },
  "notifications:preferences": { authorization: "active_organization_viewer", response: "metadata" },
  "notifications:updatePreferences": { authorization: "active_organization_viewer", response: "none" },
  "organizations:listMine": { authorization: "authenticated_user", response: "metadata" },
  "organizations:active": { authorization: "authenticated_user", response: "metadata" },
  "organizations:selectActive": { authorization: "active_organization_viewer", response: "metadata" },
  "organizations:clearActive": { authorization: "authenticated_user", response: "none" },
  "permissionReceipts:current": { authorization: "active_organization_viewer", response: "personal_identity" },
  // The only unauthenticated entry in this table. It answers with counts, sums and status
  // literals and nothing else - no organization, repository, actor or finding is identifiable
  // from what it returns - which is why it can be "public_webhook" and still be "metadata".
  "publicProof:summary": { authorization: "public_webhook", response: "metadata" },
  "repositoryConnections:current": { authorization: "authenticated_user", response: "metadata" },
  "repositoryConnections:setReviewPolicy": { authorization: "active_organization_admin_recent_auth", response: "none" },
  "runtimeReadiness:current": { authorization: "authenticated_user", response: "metadata" },
  "reviews:list": { authorization: "active_organization_viewer", response: "metadata" },
  "reviews:get": { authorization: "active_organization_viewer", response: "metadata" },
  "reviews:getEvidence": { authorization: "active_organization_viewer", response: "metadata" },
  "reviewEvidenceActions:getFindingDetails": { authorization: "active_organization_viewer", response: "authorized_source_derived" },
  "users:viewer": { authorization: "authenticated_user", response: "personal_identity" },
  "users:sessions": { authorization: "authenticated_user", response: "metadata" },
  "users:revokeOtherSessions": { authorization: "authenticated_user", response: "metadata" },
  "usage:summarize": { authorization: "active_organization_viewer", response: "metadata" },
} as const satisfies Record<string, { authorization: AuthorizationPolicy; response: ResponseClassification }>;
