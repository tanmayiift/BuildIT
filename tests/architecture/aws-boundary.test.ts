import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const template = readFileSync(fileURLToPath(new URL("../../infra/aws/artifacts.yaml", import.meta.url)), "utf8");

describe("AWS artifact and key boundary", () => {
  it("fails deployment outside Ireland and never creates a multi-region key", () => {
    expect(template).toContain("AWS::Region\", eu-west-1");
    expect(template).toContain("MultiRegion: false");
  });

  it("requires a dedicated role and tenant-bound KMS context", () => {
    expect(template).toContain("ContentBrokerRole:");
    expect(template).toContain("sts:AssumeRoleWithWebIdentity");
    expect(template).toContain("project:${VercelProjectName}:environment:production");
    expect(template).not.toContain("environment:preview");
    for (const field of ["organizationId", "credentialId", "purpose"]) {
      expect(template).toContain(`kms:EncryptionContext:${field}`);
    }
  });

  it("keeps the bucket private, non-versioned, encrypted, and short-lived", () => {
    for (const rule of ["BlockPublicAcls: true", "BlockPublicPolicy: true", "RestrictPublicBuckets: true", "Status: Suspended", "SSEAlgorithm: aws:kms", "MaxValue: 7", "ExpirationInDays: !Ref ArtifactRetentionDays"]) {
      expect(template).toContain(rule);
    }
  });

  it("denies plaintext transport and writes using the wrong key", () => {
    expect(template).toContain('"aws:SecureTransport": "false"');
    expect(template).toContain('"Null":');
    expect(template).toContain("DenyUnencryptedObjectWrites");
    expect(template).toContain("DenyWrongEncryptionKey");
  });

  it("writes a daily encrypted deletion inventory and expires it after 14 days", () => {
    expect(template).toContain("Id: DailyDeletionAudit");
    expect(template).toContain("ScheduleFrequency: Daily");
    expect(template.match(/SSEAlgorithm: aws:kms/g)).toHaveLength(2);
    expect(template).toContain("Id: ExpireDeletionInventory");
    expect(template).toContain("ExpirationInDays: 14");
  });
});
