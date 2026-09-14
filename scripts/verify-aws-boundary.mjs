import { spawnSync } from "node:child_process";

const region = process.env.BUILDIT_AWS_REGION ?? "eu-west-1";
const stackName = process.env.BUILDIT_AWS_STACK ?? "buildit-production-artifacts";
if (region !== "eu-west-1") throw new Error("aws_boundary_region_must_be_eu_west_1");
if (!/^buildit(?:-[a-z0-9]+)+$/.test(stackName)) throw new Error("aws_boundary_buildit_stack_required");

function awsEnvironment() {
  const env = {};
  for (const key of ["PATH", "HOME", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
    "AWS_PROFILE", "AWS_CONFIG_FILE", "AWS_SHARED_CREDENTIALS_FILE", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_ROLE_ARN", "AWS_ROLE_SESSION_NAME"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}
function aws(args) {
  const result = spawnSync("aws", [...args, "--region", region, "--output", "json"], { encoding: "utf8", env: awsEnvironment() });
  if (result.status !== 0) throw new Error(`aws_boundary_command_failed:${args[0]}:${args[1] ?? ""}`);
  return JSON.parse(result.stdout);
}
function requireTrue(value, code) { if (!value) throw new Error(code); }
const list = value => Array.isArray(value) ? value : value === undefined ? [] : [value];
const conditionValue = (condition, key) => Object.entries(condition ?? {}).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1];
const wildcardMatches = (pattern, value) => typeof pattern === "string" && new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$").test(value);
function readPolicy(value) {
  if (typeof value === "string") { try { return JSON.parse(value); } catch { try { return JSON.parse(decodeURIComponent(value)); } catch { throw new Error("aws_boundary_policy_invalid"); } } }
  requireTrue(value && typeof value === "object", "aws_boundary_policy_invalid");
  return value;
}
// This checks the documented, exact S3 grant shape, not arbitrary IAM equivalence. Unknown
// deny conditions fail closed rather than claiming that a policy we cannot prove is safe.
function scopedServiceGrant(policy, action, resource, account, sourceArn, extra = {}, requestResource = resource) {
  const statements = list(readPolicy(policy).Statement);
  const allowedContext = { "aws:sourceaccount": account, "aws:sourcearn": sourceArn, ...Object.fromEntries(Object.entries(extra).map(([key, value]) => [key.toLowerCase(), value])) };
  const allowedConditions = new Set(["StringEquals/aws:sourceaccount", "ArnLike/aws:sourcearn", "ArnEquals/aws:sourcearn", ...Object.keys(extra).map(key => `StringEquals/${key.toLowerCase()}`)]);
  const allowed = statements.some(item => item.Effect === "Allow" && item.Principal?.Service === "s3.amazonaws.com" && Object.keys(item.Principal).length === 1
    && list(item.Action).length === 1 && list(item.Action)[0] === action
    && list(item.Resource).length === 1 && list(item.Resource)[0] === resource
    && conditionValue(item.Condition?.StringEquals, "aws:SourceAccount") === account
    && (conditionValue(item.Condition?.ArnLike, "aws:SourceArn") ?? conditionValue(item.Condition?.ArnEquals, "aws:SourceArn")) === sourceArn
    && Object.entries(extra).every(([key, value]) => conditionValue(item.Condition?.StringEquals, key) === value)
    && Object.entries(item.Condition ?? {}).every(([operator, conditions]) => Object.entries(conditions).every(([key, expected]) => allowedConditions.has(`${operator}/${key.toLowerCase()}`) && expected === allowedContext[key.toLowerCase()])));
  const context = { "aws:sourceaccount": account, "aws:sourcearn": sourceArn, "aws:securetransport": "true", "aws:requestedregion": region, ...Object.fromEntries(Object.entries(extra).map(([key, value]) => [key.toLowerCase(), value])) };
  const denied = statements.some(item => {
    if (item.Effect !== "Deny" || !(item.NotPrincipal || item.Principal === "*" || list(item.Principal?.Service).includes("s3.amazonaws.com") || list(item.Principal?.AWS).includes("*"))) return false;
    if (item.Action && !list(item.Action).some(pattern => wildcardMatches(pattern, action))) return false;
    if (item.Resource && !list(item.Resource).some(pattern => wildcardMatches(pattern, requestResource) || wildcardMatches(requestResource, pattern))) return false;
    return Object.entries(item.Condition ?? {}).every(([operator, conditions]) => Object.entries(conditions).every(([key, expected]) => {
      const value = context[key.toLowerCase()];
      if (value === undefined) return true;
      if (["StringEquals", "ArnEquals", "Bool"].includes(operator)) return list(expected).some(entry => String(entry) === value);
      if (["StringNotEquals", "ArnNotEquals"].includes(operator)) return list(expected).every(entry => String(entry) !== value);
      if (["StringLike", "ArnLike"].includes(operator)) return list(expected).some(entry => wildcardMatches(entry, value));
      return true;
    }));
  });
  return allowed && !denied;
}
function verifyInventoryBucket(bucket, kmsKey) {
  requireTrue(aws(["s3api", "get-bucket-location", "--bucket", bucket]).LocationConstraint === region, "aws_boundary_inventory_region_invalid");
  const encryption = aws(["s3api", "get-bucket-encryption", "--bucket", bucket]).ServerSideEncryptionConfiguration?.Rules?.[0]?.ApplyServerSideEncryptionByDefault;
  requireTrue(encryption?.SSEAlgorithm === "aws:kms" && encryption?.KMSMasterKeyID === kmsKey, "aws_boundary_inventory_encryption_invalid");
  const block = aws(["s3api", "get-public-access-block", "--bucket", bucket]).PublicAccessBlockConfiguration;
  requireTrue(block?.BlockPublicAcls && block?.IgnorePublicAcls && block?.BlockPublicPolicy && block?.RestrictPublicBuckets, "aws_boundary_inventory_public_access_block_invalid");
  requireTrue(aws(["s3api", "get-bucket-policy-status", "--bucket", bucket]).PolicyStatus?.IsPublic === false, "aws_boundary_inventory_bucket_is_public");
  const versioning = aws(["s3api", "get-bucket-versioning", "--bucket", bucket]);
  requireTrue(!versioning.Status || versioning.Status === "Suspended", "aws_boundary_inventory_versioning_invalid");
  let keyMarker, versionMarker, pages = 0;
  do {
    const page = aws(["s3api", "list-object-versions", "--no-paginate", "--bucket", bucket, "--max-keys", "1000", ...(keyMarker ? ["--key-marker", keyMarker] : []), ...(versionMarker ? ["--version-id-marker", versionMarker] : [])]);
    requireTrue([...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])].every(item => item.VersionId === "null"), "aws_boundary_inventory_historical_versions_present");
    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined; versionMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined; pages += 1;
    requireTrue(!page.IsTruncated || (typeof keyMarker === "string" && pages < 50), "aws_boundary_inventory_version_scan_incomplete");
  } while (keyMarker);
  const rules = aws(["s3api", "get-bucket-lifecycle-configuration", "--bucket", bucket]).Rules ?? [];
  const expiry = rules.find(item => item.ID === "ExpireDeletionInventory");
  requireTrue(expiry?.Status === "Enabled" && expiry?.Expiration?.Days === 14
    && (!expiry.Filter || Object.keys(expiry.Filter).length === 0 || (Object.keys(expiry.Filter).length === 1 && ["", "inventory/"].includes(expiry.Filter.Prefix)))
    && (!expiry.Prefix || expiry.Prefix === "inventory/"), "aws_boundary_inventory_expiry_invalid");
}
function verifyInventoryDelivery(bucket, inventory, kmsKey, account) {
  const sourceArn = `arn:aws:s3:::${bucket}`, destinationArn = `arn:aws:s3:::${inventory}`;
  const configuration = aws(["s3api", "get-bucket-inventory-configuration", "--bucket", bucket, "--id", "DailyDeletionAudit"]).InventoryConfiguration;
  const destination = configuration?.Destination?.S3BucketDestination;
  requireTrue(configuration?.Id === "DailyDeletionAudit" && configuration.IsEnabled === true && configuration.IncludedObjectVersions === "Current"
    && configuration.Schedule?.Frequency === "Daily" && (!configuration.Filter || Object.keys(configuration.Filter).length === 0 || configuration.Filter.Prefix === "")
    && destination?.Bucket === destinationArn && destination.Prefix === "inventory" && destination.Format === "CSV"
    && (!destination.AccountId || destination.AccountId === account)
    && (!destination.Encryption || destination.Encryption.SSEKMS?.KeyId === kmsKey), "aws_boundary_inventory_configuration_invalid");
  const policy = aws(["s3api", "get-bucket-policy", "--bucket", inventory]).Policy;
  requireTrue(scopedServiceGrant(policy, "s3:PutObject", `${destinationArn}/inventory/*`, account, sourceArn, { "s3:x-amz-acl": "bucket-owner-full-control" }), "aws_boundary_inventory_delivery_permission_invalid");
  const keyPolicy = aws(["kms", "get-key-policy", "--key-id", kmsKey, "--policy-name", "default"]).Policy;
  requireTrue(scopedServiceGrant(keyPolicy, "kms:GenerateDataKey", "*", account, sourceArn, {}, kmsKey), "aws_boundary_inventory_kms_permission_invalid");
  const prefix = `inventory/${bucket}/DailyDeletionAudit/`, objects = [];
  let continuation, pages = 0;
  do {
    const page = aws(["s3api", "list-objects-v2", "--no-paginate", "--bucket", inventory, "--prefix", prefix, "--max-keys", "1000", ...(continuation ? ["--continuation-token", continuation] : [])]);
    objects.push(...(page.Contents ?? [])); pages += 1;
    continuation = page.IsTruncated ? page.NextContinuationToken : undefined;
    requireTrue(!page.IsTruncated || (typeof continuation === "string" && pages < 50), "aws_boundary_inventory_scan_incomplete");
  } while (continuation);
  const manifests = objects.filter(item => typeof item.Key === "string" && item.Key.startsWith(prefix) && item.Key.endsWith("/manifest.json")
    && objects.some(checksum => checksum.Key === item.Key.replace(/manifest\.json$/, "manifest.checksum"))).sort((a, b) => Date.parse(b.LastModified) - Date.parse(a.LastModified));
  const latest = manifests[0], ageMs = Date.now() - Date.parse(latest?.LastModified ?? "");
  requireTrue(latest && Number.isFinite(ageMs) && ageMs >= -300_000 && ageMs <= 48 * 3600_000, "aws_boundary_inventory_delivery_missing_or_stale");
  for (const objectKey of [latest.Key, latest.Key.replace(/manifest\.json$/, "manifest.checksum")]) {
    const head = aws(["s3api", "head-object", "--bucket", inventory, "--key", objectKey]);
    requireTrue(head.ServerSideEncryption === "aws:kms" && head.SSEKMSKeyId === kmsKey, "aws_boundary_inventory_object_encryption_invalid");
  }
  return { ageHours: Math.round(ageMs / 3600_000 * 10) / 10, proof: "recent_encrypted_manifest_and_checksum" };
}
function verifyBrokerTrust(roleArn, account) {
  const roleName = "buildit-production-content-broker", team = "buildit-agentic-review", project = "buildit-content-broker";
  const issuer = `oidc.vercel.com/${team}`, providerArn = `arn:aws:iam::${account}:oidc-provider/${issuer}`;
  requireTrue(roleArn === `arn:aws:iam::${account}:role/${roleName}`, "aws_boundary_broker_role_scope_invalid");
  const role = aws(["iam", "get-role", "--role-name", roleName]).Role;
  requireTrue(role?.Arn === roleArn, "aws_boundary_broker_role_invalid");
  const statements = list(readPolicy(role.AssumeRolePolicyDocument).Statement);
  const statement = statements[0], equals = statement?.Condition?.StringEquals;
  requireTrue(statements.length === 1 && statement.Effect === "Allow" && statement.Principal?.Federated === providerArn && Object.keys(statement.Principal).length === 1
    && list(statement.Action).length === 1 && list(statement.Action)[0] === "sts:AssumeRoleWithWebIdentity"
    && Object.keys(statement.Condition ?? {}).length === 1 && Object.keys(equals ?? {}).length === 2
    && equals?.[`${issuer}:aud`] === `https://vercel.com/${team}` && equals?.[`${issuer}:sub`] === `owner:${team}:project:${project}:environment:production`, "aws_boundary_broker_trust_invalid");
  const provider = aws(["iam", "get-open-id-connect-provider", "--open-id-connect-provider-arn", providerArn]);
  requireTrue(provider.Url === issuer && provider.ClientIDList?.length === 1 && provider.ClientIDList[0] === `https://vercel.com/${team}`, "aws_boundary_oidc_provider_invalid");
  // Read only this BuildIT stack's ownership record. Never inspect a different team's provider.
  const recorded = aws(["cloudformation", "describe-stack-resource", "--stack-name", stackName, "--logical-resource-id", "VercelOidcProvider"]).StackResourceDetail;
  requireTrue(recorded?.PhysicalResourceId === providerArn, "aws_boundary_oidc_stack_drift");
  // No identity policies are required: the broker's access comes from the bucket and key policies.
}


const stack = aws(["cloudformation", "describe-stacks", "--stack-name", stackName]).Stacks?.[0];
requireTrue(stack?.StackStatus === "CREATE_COMPLETE" || stack?.StackStatus === "UPDATE_COMPLETE", "aws_boundary_stack_not_ready");
const outputs = Object.fromEntries((stack.Outputs ?? []).map(item => [item.OutputKey, item.OutputValue]));
for (const key of ["ArtifactBucketName", "InventoryBucketName", "KmsKeyArn", "KmsAlias", "ContentBrokerRoleArn"]) requireTrue(typeof outputs[key] === "string" && outputs[key].length > 0, `aws_boundary_output_missing:${key}`);

const bucket = outputs.ArtifactBucketName, kmsKey = outputs.KmsKeyArn;
const scope = /^buildit-(production|staging)-(\d{12})-artifacts-eu-west-1$/.exec(bucket);
requireTrue(scope && outputs.InventoryBucketName === `buildit-${scope[1]}-${scope[2]}-artifact-inventory-eu-west-1`
  && kmsKey.startsWith(`arn:aws:kms:${region}:${scope[2]}:key/`) && outputs.KmsAlias === `alias/buildit-${scope[1]}-eu-west-1`, "aws_boundary_resource_scope_invalid");
requireTrue(aws(["s3api", "get-bucket-location", "--bucket", bucket]).LocationConstraint === region, "aws_boundary_artifact_region_invalid");
const encryption = aws(["s3api", "get-bucket-encryption", "--bucket", bucket]);
const rule = encryption.ServerSideEncryptionConfiguration?.Rules?.[0]?.ApplyServerSideEncryptionByDefault;
requireTrue(rule?.SSEAlgorithm === "aws:kms" && rule?.KMSMasterKeyID === kmsKey, "aws_boundary_default_encryption_invalid");
const block = aws(["s3api", "get-public-access-block", "--bucket", bucket]).PublicAccessBlockConfiguration;
requireTrue(block?.BlockPublicAcls && block?.IgnorePublicAcls && block?.BlockPublicPolicy && block?.RestrictPublicBuckets, "aws_boundary_public_access_block_invalid");
const policy = aws(["s3api", "get-bucket-policy-status", "--bucket", bucket]).PolicyStatus;
requireTrue(policy?.IsPublic === false, "aws_boundary_bucket_is_public");
const versioning = aws(["s3api", "get-bucket-versioning", "--bucket", bucket]);
requireTrue(!versioning.Status || versioning.Status === "Suspended", "aws_boundary_versioning_must_be_disabled");
let keyMarker, versionIdMarker;
do {
  const page = aws(["s3api", "list-object-versions", "--no-paginate", "--bucket", bucket, "--max-keys", "1000", ...(keyMarker ? ["--key-marker", keyMarker] : []), ...(versionIdMarker ? ["--version-id-marker", versionIdMarker] : [])]);
  requireTrue([...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])].every(item => item.VersionId === "null"), "aws_boundary_historical_versions_present");
  keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
  versionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
  requireTrue(!page.IsTruncated || typeof keyMarker === "string", "aws_boundary_version_scan_incomplete");
} while (keyMarker);
const lifecycle = aws(["s3api", "get-bucket-lifecycle-configuration", "--bucket", bucket]).Rules ?? [];
const artifactRule = lifecycle.find(item => item.ID === "ExpungeEphemeralArtifacts"), replayRule = lifecycle.find(item => item.ID === "ExpungeReplayMarkers");
requireTrue(artifactRule?.Status === "Enabled" && (artifactRule.Filter?.Prefix ?? artifactRule.Prefix) === "artifacts/" && artifactRule?.Expiration?.Days > 0 && artifactRule.Expiration.Days <= 7, "aws_boundary_artifact_expiry_invalid");
requireTrue(replayRule?.Status === "Enabled" && (replayRule?.Filter?.Prefix ?? replayRule?.Prefix) === "grant-replay/" && replayRule?.Expiration?.Days === 1, "aws_boundary_replay_expiry_invalid");
const keyId = kmsKey.split("/").at(-1);
const key = aws(["kms", "describe-key", "--key-id", keyId]).KeyMetadata;
requireTrue(key?.KeyState === "Enabled" && key?.Enabled === true && key?.MultiRegion === false, "aws_boundary_kms_key_invalid");
requireTrue(aws(["kms", "get-key-rotation-status", "--key-id", keyId]).KeyRotationEnabled === true, "aws_boundary_kms_rotation_disabled");

verifyInventoryBucket(outputs.InventoryBucketName, kmsKey);
const inventoryDelivery = verifyInventoryDelivery(bucket, outputs.InventoryBucketName, kmsKey, scope[2]);
verifyBrokerTrust(outputs.ContentBrokerRoleArn, scope[2]);

process.stdout.write(`${JSON.stringify({ status: "passed", stack: stackName, region, encryption: "aws:kms", public: false, artifactRetentionDays: artifactRule.Expiration.Days, replayRetentionDays: replayRule.Expiration.Days, versioning: "disabled", kmsRotation: true, inventoryRetentionDays: 14, inventoryDelivery, brokerTrust: "exact_buildit_production_project", oidcStackOwnership: "matches" })}\n`);
