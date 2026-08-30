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
    expect(template).toContain("BrokerS3ArtifactEncryption");
    expect(template).toContain('"kms:ViaService": s3.eu-west-1.amazonaws.com');
    expect(template).toContain('"kms:EncryptionContext:aws:s3:arn"');
    expect(template).toContain("BucketKeyEnabled: true");
  });

  it("keeps the bucket private, non-versioned, encrypted, and short-lived", () => {
    for (const rule of ["BlockPublicAcls: true", "BlockPublicPolicy: true", "RestrictPublicBuckets: true", "Status: Suspended", "SSEAlgorithm: aws:kms", "MaxValue: 7", "ExpirationInDays: !Ref ArtifactRetentionDays"]) {
      expect(template).toContain(rule);
    }
    expect(template).toContain("Id: ExpungeReplayMarkers");
    expect(template).toContain("Prefix: grant-replay/");
    expect(template).toContain("ExpirationInDays: 1");
  });

  it("denies plaintext transport and writes using the wrong key", () => {
    expect(template).toContain('"aws:SecureTransport": "false"');
    expect(template).toContain('"Null":');
    expect(template).toContain("DenyUnencryptedObjectWrites");
    expect(template).toContain("DenyWrongEncryptionKey");
    expect(template).toContain("BrokerCreatesReplayMarkersOnly");
    expect(template).toContain("${ArtifactBucket.Arn}/grant-replay/*");
  });

  it("writes a daily encrypted deletion inventory and expires it after 14 days", () => {
    expect(template).toContain("Id: DailyDeletionAudit");
    expect(template).toContain("ScheduleFrequency: Daily");
    expect(template.match(/SSEAlgorithm: aws:kms/g)).toHaveLength(2);
    expect(template).toContain("Id: ExpireDeletionInventory");
    expect(template).toContain("ExpirationInDays: 14");
  });
});
