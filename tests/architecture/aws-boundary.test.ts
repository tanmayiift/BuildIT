import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const template = readFileSync(fileURLToPath(new URL("../../infra/aws/artifacts.yaml", import.meta.url)), "utf8");
const verifier = readFileSync(fileURLToPath(new URL("../../scripts/verify-aws-boundary.mjs", import.meta.url)), "utf8");
const brokerAwsRoutes = ["credentials", "artifacts", "model", "tracker", "tracker-credentials"].map((name) =>
    readFileSync(fileURLToPath(new URL(`../../packages/broker/api/${name}.ts`, import.meta.url)), "utf8"),
  ),
  executeRoute = readFileSync(fileURLToPath(new URL("../../packages/broker/api/execute.ts", import.meta.url)), "utf8");

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

  it("keeps the repeatable live verifier read-only and aligned with the stack", () => {
    for (const check of ["get-bucket-encryption", "get-public-access-block", "get-bucket-policy-status", "get-bucket-versioning", "list-object-versions", "get-bucket-lifecycle-configuration", "describe-key", "get-key-rotation-status", "ExpungeEphemeralArtifacts", "ExpungeReplayMarkers"]) expect(verifier).toContain(check);
    for (const write of ["put-object", "delete-object", "update-stack", "schedule-key-deletion"]) expect(verifier).not.toContain(write);
    expect(verifier).toContain('region !== "eu-west-1"');
    expect(verifier).toContain('item.VersionId === "null"');
  });

  it("uses Vercel's maintained request-scoped AWS OIDC provider in every broker route", () => {
    for (const source of brokerAwsRoutes) {
      expect(source).toContain('from "@vercel/oidc-aws-credentials-provider"');
      expect(source).toContain("awsCredentialsProvider({");
      expect(source).not.toContain("fromWebToken");
      expect(source).not.toContain('get("x-vercel-oidc-token")');
    }
    expect(executeRoute).toContain('from "@vercel/oidc-aws-credentials-provider"');
    expect(executeRoute).toContain("awsCredentialsProvider({");
    expect(executeRoute).not.toContain("fromWebToken");
  });

  it("passes Vercel's request OIDC token only to the sandbox control plane", () => {
    expect(executeRoute).toContain('get("x-vercel-oidc-token")');
    expect(executeRoute).toContain("sandboxCredentials: sandboxCredentials(request)");
    expect(executeRoute).not.toContain("AWS_WEB_IDENTITY_TOKEN_FILE");
    expect(executeRoute).not.toContain("process.env.VERCEL_OIDC_TOKEN");
  });
});

// artifacts.yaml could not be deployed. The trust policy used `!Sub` as a map KEY, which CloudFormation
// parses as an intrinsic-function map and rejects with "map keys must be strings" - so every
// `aws cloudformation deploy` of this file failed validation before touching anything, and nothing
// ran validate-template to notice. It was found on 2 October 2026 by creating a change set, which is
// also how it was proven fixed. This test cannot call AWS, so it pins the shape that broke instead.
describe("the CloudFormation template is deployable", () => {
  const template = readFileSync(fileURLToPath(new URL("../../infra/aws/artifacts.yaml", import.meta.url)), "utf8");

  it("never uses an intrinsic function as a map key", () => {
    // A YAML key that begins with a tag: `!Sub "x": y`. CloudFormation requires string keys.
    //
    // The quoted key is consumed as a unit because the real defect had colons INSIDE it -
    // `"oidc.vercel.com/${VercelTeamSlug}:aud"` - and the first version of this regex used [^:]* and
    // stopped at that colon, so it would not have caught the very bug it was written for. A
    // mutation run caught that; the case below pins the original line verbatim so it cannot recur.
    const intrinsicKey = /^\s*!(Sub|Ref|GetAtt|Join|Select|If)\s+("[^"]*"|'[^']*'|[^\s:]+)\s*:(\s|$)/;
    const offending = template.split("\n").filter(line => intrinsicKey.test(line));
    expect(offending, "an intrinsic used as a key makes the whole template undeployable").toEqual([]);

    // The exact lines that made the template undeployable, which this pattern must recognise.
    for (const original of [
      '                !Sub "oidc.vercel.com/${VercelTeamSlug}:aud": !Sub https://vercel.com/${VercelTeamSlug}',
      '                !Sub "oidc.vercel.com/${VercelTeamSlug}:sub": !Sub owner:${VercelTeamSlug}:project:${VercelProjectName}:environment:production',
    ]) expect(intrinsicKey.test(original), `must catch: ${original.trim().slice(0, 50)}`).toBe(true);
    // And must not fire on an intrinsic used correctly, as a value.
    expect(intrinsicKey.test("      Federated: !Ref VercelOidcProvider")).toBe(false);
    expect(intrinsicKey.test("      AssumeRolePolicyDocument: !Sub |")).toBe(false);
  });

  it("builds the trust condition, whose keys carry the team slug, as a substituted JSON string", () => {
    expect(template).toMatch(/AssumeRolePolicyDocument:\s*!Sub\s*\|/);
    expect(template).toContain('"oidc.vercel.com/${VercelTeamSlug}:aud"');
    expect(template).toContain('"oidc.vercel.com/${VercelTeamSlug}:sub"');
  });

  it("defaults the team to BuildIT's own, never the deleted Pulsetrade team", () => {
    expect(template).toMatch(/VercelTeamSlug:[\s\S]*?Default:\s*buildit-agentic-review/);
    expect(template.toLowerCase()).not.toContain("pulsetrade");
  });
});

// The live stack's stored template still describes Pulsetrade while the role trusts BuildIT, so any
// update would act on that disagreement - and a read-only change set showed it would also modify the
// KMS key and both bucket policies. The stack policy denies every update until someone overrides it
// deliberately for one operation. scripts/verify-aws-boundary.mjs checks it is attached live; this
// checks the committed copy still says what the live one does.
describe("the stack is protected against an accidental update", () => {
  const policy = JSON.parse(readFileSync(fileURLToPath(new URL("../../infra/aws/stack-policy.json", import.meta.url)), "utf8")) as {
    Statement: Array<{ Effect: string; Action: string | string[]; Resource: string | string[]; Principal: string }>;
  };

  it("denies every update on every resource", () => {
    const denyAll = policy.Statement.find(item => item.Effect === "Deny"
      && [item.Action].flat().includes("Update:*") && [item.Resource].flat().includes("*"));
    expect(denyAll, "the protection must cover Update:* on *").toBeTruthy();
  });

  it("allows nothing, so there is no carve-out a later edit could widen", () => {
    expect(policy.Statement.filter(item => item.Effect === "Allow")).toEqual([]);
  });

  it("is checked against the live stack by the boundary gate", () => {
    const gate = readFileSync(fileURLToPath(new URL("../../scripts/verify-aws-boundary.mjs", import.meta.url)), "utf8");
    expect(gate).toContain("aws_boundary_stack_unprotected");
    expect(gate).toMatch(/verifyStackProtected\(\);\s*\n\s*verifyBrokerTrust/);
  });
});
