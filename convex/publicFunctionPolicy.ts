export type AuthorizationPolicy =
  | "public_webhook"
  | "authenticated_user"
  | "active_organization_viewer"
  | "active_organization_developer"
  | "active_organization_admin"
  | "active_organization_admin_recent_auth"
  | "invited_user";

export type ResponseClassification = "none" | "metadata" | "personal_identity";

export const publicFunctionPolicies = {
  "activation:funnel": { authorization: "active_organization_viewer", response: "metadata" },
  "audit:list": { authorization: "active_organization_viewer", response: "metadata" },
  "artifacts:getMetadata": { authorization: "active_organization_viewer", response: "metadata" },
  "dashboardReviews:prepare": { authorization: "active_organization_developer", response: "metadata" },
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
  "memberships:accept": { authorization: "invited_user", response: "metadata" },
  "memberships:changeRole": { authorization: "active_organization_admin_recent_auth", response: "none" },
  "memberships:remove": { authorization: "active_organization_admin_recent_auth", response: "none" },
  "metrics:summarize": { authorization: "active_organization_viewer", response: "metadata" },
  "organizations:listMine": { authorization: "authenticated_user", response: "metadata" },
  "organizations:active": { authorization: "authenticated_user", response: "metadata" },
  "organizations:selectActive": { authorization: "active_organization_viewer", response: "metadata" },
  "organizations:clearActive": { authorization: "authenticated_user", response: "none" },
  "permissionReceipts:current": { authorization: "active_organization_viewer", response: "personal_identity" },
  "repositoryConnections:current": { authorization: "authenticated_user", response: "metadata" },
  "reviews:list": { authorization: "active_organization_viewer", response: "metadata" },
  "reviews:get": { authorization: "active_organization_viewer", response: "metadata" },
  "reviews:getEvidence": { authorization: "active_organization_viewer", response: "metadata" },
  "users:viewer": { authorization: "authenticated_user", response: "personal_identity" },
  "users:sessions": { authorization: "authenticated_user", response: "metadata" },
  "users:revokeOtherSessions": { authorization: "authenticated_user", response: "metadata" },
  "usage:summarize": { authorization: "active_organization_viewer", response: "metadata" },
} as const satisfies Record<string, { authorization: AuthorizationPolicy; response: ResponseClassification }>;
