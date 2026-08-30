export type StoredTextClassification =
  | "metadata"
  | "personal_identity"
  | "hashed_metadata"
  | "encrypted_secret"
  | "artifact_locator"
  | "operational_identifier";

export const storedTextClassifications = {
  aadDigest: "hashed_metadata", accountLogin: "metadata", action: "metadata",
  actorId: "operational_identifier", approvedBy: "operational_identifier",
  architecture: "metadata", authTag: "encrypted_secret", baseRef: "metadata",
  baseSha: "operational_identifier", blockedReason: "metadata", branchNameHash: "hashed_metadata",
  budgetCeilingId: "operational_identifier", cancelledBy: "operational_identifier",
  candidateCommitSha: "operational_identifier", checksum: "hashed_metadata",
  commandFingerprint: "hashed_metadata", commitSha: "operational_identifier", credentialScopeId: "operational_identifier",
  contentHash: "hashed_metadata", createdBy: "operational_identifier", currency: "metadata",
  dedupeKey: "operational_identifier", defaultBranch: "metadata", deliveryId: "operational_identifier",
  deletionLeaseId: "operational_identifier", lastDeletionErrorCode: "metadata",
  dismissedBy: "operational_identifier", encryptedAccessToken: "encrypted_secret",
  encryptedCiphertext: "encrypted_secret", encryptedRefreshToken: "encrypted_secret",
  evalSetVersion: "metadata", event: "metadata", eventHash: "hashed_metadata",
  externalId: "operational_identifier", externalIdHash: "hashed_metadata",
  email: "personal_identity", fetchedVersion: "metadata", fingerprintHmac: "hashed_metadata",
  githubLogin: "personal_identity", headSha: "operational_identifier", headRefHash: "hashed_metadata", baseRefHash: "hashed_metadata", image: "personal_identity",
  internalCode: "metadata", leaseOwner: "operational_identifier", login: "personal_identity", maskedSuffix: "metadata",
  model: "metadata", modelVersion: "metadata", name: "metadata", nameHash: "hashed_metadata",
  networkPolicyVersion: "metadata", nonce: "encrypted_secret", observedHeadSha: "operational_identifier",
  operationKey: "operational_identifier", organizationTimezone: "metadata", owner: "metadata", wrappedDataKey: "encrypted_secret", kmsKeyId: "operational_identifier", envelopeVersion: "metadata",
  patchFingerprint: "hashed_metadata", pathHmac: "hashed_metadata", planId: "metadata",
  previousHash: "hashed_metadata", promptVersion: "metadata", reasonCode: "metadata",
  rejectionReasonCode: "metadata", requestHash: "hashed_metadata", requestId: "operational_identifier",
  resourceIdHash: "hashed_metadata", resourceType: "metadata", ruleId: "metadata",
  rulesDigest: "hashed_metadata", runnerImageVersion: "metadata", sandboxId: "operational_identifier",
  schemaVersion: "metadata", scopeValueHmac: "hashed_metadata", slug: "metadata",
  sourceCommitSha: "operational_identifier", sourceHeadSha: "operational_identifier",
  sourceRef: "metadata", sourceUrlHash: "hashed_metadata", storageKey: "artifact_locator",
  phone: "personal_identity", timezone: "metadata", triggerActor: "operational_identifier", trustedRef: "metadata",
  trustedRefSha: "operational_identifier", userId: "operational_identifier", version: "metadata",
  workspaceId: "operational_identifier", workflowId: "operational_identifier",
} as const satisfies Record<string, StoredTextClassification>;

export const forbiddenInlineSourceFieldPattern = /(^|_)(code|diff|snippet|path|log|output|patch|prompt|prose|message|title|body|excerpt|command|source)(_|$)/i;
