import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const account = "111122223333", bucket = `buildit-production-${account}-artifacts-eu-west-1`, inventory = `buildit-production-${account}-artifact-inventory-eu-west-1`;
const keyArn = `arn:aws:kms:eu-west-1:${account}:key/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`, roleArn = `arn:aws:iam::${account}:role/buildit-production-content-broker`;
const team = "buildit-agentic-review", issuer = `oidc.vercel.com/${team}`, providerArn = `arn:aws:iam::${account}:oidc-provider/${issuer}`;
const now = Date.now(), prefix = `inventory/${bucket}/DailyDeletionAudit/`, manifest = `${prefix}2026-09-14T00-00Z/manifest.json`;
type Statement = { Effect?: string; Principal?: { Service?: string; AWS?: string; Federated?: string }; Action?: string | string[]; Resource?: string; Condition?: Record<string, Record<string, unknown>> };
const inventoryGrant: Statement = { Effect: "Allow", Principal: { Service: "s3.amazonaws.com" }, Action: "kms:GenerateDataKey", Resource: "*", Condition: { StringEquals: { "aws:SourceAccount": account }, ArnLike: { "aws:SourceArn": `arn:aws:s3:::${bucket}` } } };
const trust = { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Federated: providerArn }, Action: "sts:AssumeRoleWithWebIdentity", Condition: { StringEquals: { [`${issuer}:aud`]: `https://vercel.com/${team}`, [`${issuer}:sub`]: `owner:${team}:project:buildit-content-broker:environment:production` } } }] };
const outputs = { ArtifactBucketName: bucket, InventoryBucketName: inventory, KmsKeyArn: keyArn, KmsAlias: "alias/buildit-production-eu-west-1", ContentBrokerRoleArn: roleArn };
const source = readFileSync(new URL("../../scripts/verify-aws-boundary.mjs", import.meta.url), "utf8");
function fixture() {
  return {
    inventoryKeyPolicy: { Statement: [inventoryGrant] },
    objectEncryption: { ServerSideEncryption: "aws:kms", SSEKMSKeyId: keyArn },
    inventoryEncryption: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms", KMSMasterKeyID: keyArn } }] },
    inventoryLifecycle: [{ ID: "ExpireDeletionInventory", Status: "Enabled", Expiration: { Days: 14 } }],
    inventoryConfiguration: { Id: "DailyDeletionAudit", IsEnabled: true, IncludedObjectVersions: "Current", Schedule: { Frequency: "Daily" }, Destination: { S3BucketDestination: { Bucket: `arn:aws:s3:::${inventory}`, Prefix: "inventory", Format: "CSV" } } },
    deliveryPolicy: { Statement: [{ Effect: "Allow", Principal: { Service: "s3.amazonaws.com" }, Action: "s3:PutObject", Resource: `arn:aws:s3:::${inventory}/inventory/*`, Condition: { StringEquals: { "aws:SourceAccount": account, "s3:x-amz-acl": "bucket-owner-full-control" }, ArnLike: { "aws:SourceArn": `arn:aws:s3:::${bucket}` } } }, { Effect: "Deny", Principal: "*", Action: "s3:*", Resource: `arn:aws:s3:::${inventory}/*`, Condition: { Bool: { "aws:SecureTransport": "false" } } }] },
    objects: [{ Key: manifest, LastModified: new Date(now - 3600_000).toISOString() }, { Key: manifest.replace("manifest.json", "manifest.checksum"), LastModified: new Date(now - 3600_000).toISOString() }],
    trust,
    provider: { Url: issuer, ClientIDList: [`https://vercel.com/${team}`] },
    stackProviderArn: providerArn,
    inventoryRegion: "eu-west-1",
  };
}
function verify(data = fixture(), stackOutputs = outputs) {
  const calls: string[][] = [], output: string[] = [];
  const spawnSync = (_binary: string, args: string[]) => {
    calls.push(args); const service = args[0], operation = args[1], named = (flag: string) => args[args.indexOf(flag) + 1];
    const isInventory = named("--bucket") === inventory;
    let response: unknown;
    if (service === "cloudformation" && operation === "describe-stacks") response = { Stacks: [{ StackStatus: "UPDATE_COMPLETE", Outputs: Object.entries(stackOutputs).map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue })) }] };
    else if (service === "cloudformation" && operation === "describe-stack-resource") response = { StackResourceDetail: { PhysicalResourceId: data.stackProviderArn } };
    else if (operation === "get-bucket-encryption") response = { ServerSideEncryptionConfiguration: isInventory ? data.inventoryEncryption : { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms", KMSMasterKeyID: keyArn } }] } };
    else if (operation === "get-public-access-block") response = { PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } };
    else if (operation === "get-bucket-policy-status") response = { PolicyStatus: { IsPublic: false } };
    else if (operation === "get-bucket-versioning") response = { Status: "Suspended" };
    else if (operation === "list-object-versions") response = { Versions: [], DeleteMarkers: [], IsTruncated: false };
    else if (operation === "get-bucket-location") response = { LocationConstraint: isInventory ? data.inventoryRegion : "eu-west-1" };
    else if (operation === "get-bucket-lifecycle-configuration") response = { Rules: isInventory ? data.inventoryLifecycle : [{ ID: "ExpungeEphemeralArtifacts", Status: "Enabled", Filter: { Prefix: "artifacts/" }, Expiration: { Days: 7 } }, { ID: "ExpungeReplayMarkers", Status: "Enabled", Filter: { Prefix: "grant-replay/" }, Expiration: { Days: 1 } }] };
    else if (operation === "get-bucket-inventory-configuration") response = { InventoryConfiguration: data.inventoryConfiguration };
    else if (operation === "get-bucket-policy") response = { Policy: JSON.stringify(data.deliveryPolicy) };
    else if (operation === "list-objects-v2") response = { Contents: data.objects, IsTruncated: false };
    else if (operation === "head-object") response = data.objectEncryption;
    else if (operation === "describe-key") response = { KeyMetadata: { KeyState: "Enabled", Enabled: true, MultiRegion: false } };
    else if (operation === "get-key-rotation-status") response = { KeyRotationEnabled: true };
    else if (operation === "get-key-policy") response = { Policy: JSON.stringify(data.inventoryKeyPolicy) };
    else if (operation === "get-role") response = { Role: { Arn: roleArn, AssumeRolePolicyDocument: data.trust } };
    else if (operation === "get-open-id-connect-provider") response = data.provider;
    else throw new Error(`Unexpected fixture operation: ${service}:${operation}`);
    return { status: 0, stdout: JSON.stringify(response) };
  };
  runInNewContext(source.replace(/^import .*;$/gm, ""), { spawnSync, process: { env: {}, stdout: { write: (text: string) => output.push(text) } }, URL, Date });
  return { calls, output };
}

// Resolve this template's CloudFormation scalar references in memory. No AWS calls or source
// substring checks: the assertion inspects the actual principal/action/resource/conditions.
function templateStatements(): Statement[] {
  const yaml = createRequire(new URL("../../packages/orchestrator/package.json", import.meta.url))("js-yaml") as {
    Type: new (tag: string, options: { kind: string; construct: (value: string | string[]) => unknown }) => unknown;
    DEFAULT_SCHEMA: { extend: (types: unknown[]) => unknown }; load: (source: string, options: { schema: unknown }) => unknown;
  };
  const values: Record<string, string> = { "AWS::AccountId": account, "AWS::Partition": "aws", "AWS::Region": "eu-west-1", Environment: "production", VercelTeamSlug: team, VercelProjectName: "buildit-content-broker", "ContentBrokerRole.Arn": roleArn, "ArtifactBucket.Arn": `arn:aws:s3:::${bucket}`, "ArtifactInventoryBucket.Arn": `arn:aws:s3:::${inventory}` };
  const resolve = (value: string | string[]) => String(value).replace(/\$\{([^}]+)\}/g, (_match, name: string) => values[name] ?? name);
  const schema = yaml.DEFAULT_SCHEMA.extend([new yaml.Type("!Sub", { kind: "scalar", construct: resolve }), new yaml.Type("!Ref", { kind: "scalar", construct: value => values[String(value)] ?? String(value) }), new yaml.Type("!GetAtt", { kind: "scalar", construct: value => values[String(value)] ?? String(value) }), new yaml.Type("!Equals", { kind: "sequence", construct: value => value[0] === value[1] })]);
  const template = yaml.load(readFileSync(new URL("../../infra/aws/artifacts.yaml", import.meta.url), "utf8"), { schema }) as { Resources: { BuildITKey: { Properties: { KeyPolicy: { Statement: Statement[] } } } } };
  return template.Resources.BuildITKey.Properties.KeyPolicy.Statement;
}
function permitsInventory(statements: Statement[], sourceAccount: string, sourceBucket: string, action = "kms:GenerateDataKey") {
  return statements.some(statement => statement.Effect === "Allow" && statement.Principal?.Service === "s3.amazonaws.com" && [statement.Action].flat().includes(action) && statement.Resource === "*" && statement.Condition?.StringEquals?.["aws:SourceAccount"] === sourceAccount && statement.Condition?.ArnLike?.["aws:SourceArn"] === `arn:aws:s3:::${sourceBucket}`);
}
describe("S3 inventory encryption permission", () => {
  it("does not require encryption context for unsupported key metadata operations", () => {
    const incompatible = templateStatements().filter(statement => {
      const conditions = Object.values(statement.Condition ?? {}).flatMap(values => Object.keys(values));
      return conditions.some(key => key.startsWith("kms:EncryptionContext"))
        && [statement.Action].flat().includes("kms:DescribeKey");
    });
    expect(incompatible).toEqual([]);
  });
  it("uses string matching for S3 encryption-context values and retains both scoped paths", () => {
    const scoped = templateStatements().find(statement => statement.Principal?.AWS === roleArn
      && statement.Condition?.StringEquals?.["kms:ViaService"] === "s3.eu-west-1.amazonaws.com");
    expect(scoped?.Condition?.StringLike?.["kms:EncryptionContext:aws:s3:arn"])
      .toEqual([`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`]);
    expect(scoped?.Condition?.ArnLike).toBeUndefined();
  });
  it("lets only the source bucket/account request an inventory encryption key", () => {
    const statements = templateStatements();
    expect(permitsInventory(statements, account, bucket)).toBe(true);
    expect(permitsInventory(statements, "999988887777", bucket)).toBe(false);
    expect(permitsInventory(statements, account, "another-project-bucket")).toBe(false);
    expect(permitsInventory(statements, account, bucket, "kms:Decrypt")).toBe(false);
  });
  it("generates exactly the documented grant after substituting account and bucket parameters", () => {
    expect(templateStatements().find(statement => statement.Principal?.Service === "s3.amazonaws.com"))
      .toEqual({ Sid: "S3InventoryEncryption", ...inventoryGrant });
  });
  it("accepts the complete verified fixture without needing role identity policies", () => expect(verify().output.join("")).toContain('"status":"passed"'));
  it("fails the live verifier when the inventory service cannot use the key", () => {
    const data = fixture(); data.inventoryKeyPolicy.Statement = [];
    expect(() => verify(data)).toThrow("aws_boundary_inventory_kms_permission_invalid");
  });
  it("rejects a grant with an additional blocking condition or an explicit service denial", () => {
    const blocked = structuredClone(fixture());
    blocked.inventoryKeyPolicy.Statement[0]!.Condition!.StringEquals!["kms:ViaService"] = "another-service.amazonaws.com";
    expect(() => verify(blocked)).toThrow("aws_boundary_inventory_kms_permission_invalid");
    const contradictory = structuredClone(fixture());
    contradictory.inventoryKeyPolicy.Statement[0]!.Condition!.ArnEquals = { "aws:SourceArn": "arn:aws:s3:::another-project" };
    expect(() => verify(contradictory)).toThrow("aws_boundary_inventory_kms_permission_invalid");
    const denied = structuredClone(fixture());
    denied.inventoryKeyPolicy.Statement.push({ Effect: "Deny", Principal: { Service: "s3.amazonaws.com" }, Action: "kms:GenerateDataKey", Resource: keyArn });
    expect(() => verify(denied)).toThrow("aws_boundary_inventory_kms_permission_invalid");
  });
  it("checks the actual manifest encryption instead of relying only on the bucket default", () => {
    const data = fixture(); data.objectEncryption.ServerSideEncryption = "AES256";
    expect(() => verify(data)).toThrow("aws_boundary_inventory_object_encryption_invalid");
  });
  it("refuses non-BuildIT output resources before reading their buckets", () => {
    expect(() => verify(fixture(), { ...outputs, ArtifactBucketName: "unrelated-project" })).toThrow("aws_boundary_resource_scope_invalid");
  });
  it.each(["encryption", "expiry", "destination", "source_scope", "stale_delivery", "missing_checksum", "region", "identity", "provider", "stack_drift"])("rejects broken inventory or BuildIT identity evidence: %s", failure => {
    const data = structuredClone(fixture());
    if (failure === "encryption") data.inventoryEncryption.Rules[0]!.ApplyServerSideEncryptionByDefault.KMSMasterKeyID = "another-key";
    if (failure === "expiry") data.inventoryLifecycle[0]!.Expiration.Days = 365;
    if (failure === "destination") data.inventoryConfiguration.Destination.S3BucketDestination.Bucket = "arn:aws:s3:::another-project";
    if (failure === "source_scope") data.deliveryPolicy.Statement[0]!.Condition.StringEquals["aws:SourceAccount"] = "999988887777";
    if (failure === "stale_delivery") data.objects.forEach(item => { item.LastModified = new Date(now - 4 * 86400_000).toISOString(); });
    if (failure === "missing_checksum") data.objects.pop();
    if (failure === "region") data.inventoryRegion = "us-east-1";
    if (failure === "identity") data.trust.Statement[0]!.Condition.StringEquals[`${issuer}:sub`] = `owner:${team}:project:*:environment:production`;
    if (failure === "provider") data.provider.ClientIDList = ["https://vercel.com/another-team"];
    if (failure === "stack_drift") data.stackProviderArn = `arn:aws:iam::${account}:oidc-provider/oidc.vercel.com/legacy-other-team`;
    expect(() => verify(data)).toThrow(/aws_boundary_/);
  });
  it("only issues read operations to the scoped BuildIT resources", () => {
    const { calls } = verify();
    for (const args of calls) expect(args[1]).toMatch(/^(?:describe-|get-|list-|head-)/);
    expect(calls.some(args => args[1] === "get-key-policy")).toBe(true);
    expect(calls.some(args => args[1] === "get-bucket-inventory-configuration")).toBe(true);
    expect(calls.some(args => args[1] === "list-role-policies")).toBe(false);
  });
});
