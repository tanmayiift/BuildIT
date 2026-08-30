import { spawnSync } from "node:child_process";

const region = process.env.BUILDIT_AWS_REGION ?? "eu-west-1";
const stackName = process.env.BUILDIT_AWS_STACK ?? "buildit-production-artifacts";
if (region !== "eu-west-1") throw new Error("aws_boundary_region_must_be_eu_west_1");

function aws(args) {
  const result = spawnSync("aws", [...args, "--region", region, "--output", "json"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });
  if (result.status !== 0) throw new Error(`aws_boundary_command_failed:${args[0]}:${args[1] ?? ""}`);
  return JSON.parse(result.stdout);
}
function requireTrue(value, code) { if (!value) throw new Error(code); }

const stack = aws(["cloudformation", "describe-stacks", "--stack-name", stackName]).Stacks?.[0];
requireTrue(stack?.StackStatus === "CREATE_COMPLETE" || stack?.StackStatus === "UPDATE_COMPLETE", "aws_boundary_stack_not_ready");
const outputs = Object.fromEntries((stack.Outputs ?? []).map(item => [item.OutputKey, item.OutputValue]));
for (const key of ["ArtifactBucketName", "InventoryBucketName", "KmsKeyArn", "KmsAlias", "ContentBrokerRoleArn"]) requireTrue(typeof outputs[key] === "string" && outputs[key].length > 0, `aws_boundary_output_missing:${key}`);

const bucket = outputs.ArtifactBucketName, kmsKey = outputs.KmsKeyArn;
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
  const page = aws(["s3api", "list-object-versions", "--bucket", bucket, "--max-keys", "1000", ...(keyMarker ? ["--key-marker", keyMarker] : []), ...(versionIdMarker ? ["--version-id-marker", versionIdMarker] : [])]);
  requireTrue([...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])].every(item => item.VersionId === "null"), "aws_boundary_historical_versions_present");
  keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
  versionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
  requireTrue(!page.IsTruncated || typeof keyMarker === "string", "aws_boundary_version_scan_incomplete");
} while (keyMarker);
const lifecycle = aws(["s3api", "get-bucket-lifecycle-configuration", "--bucket", bucket]).Rules ?? [];
const artifactRule = lifecycle.find(item => item.ID === "ExpungeEphemeralArtifacts"), replayRule = lifecycle.find(item => item.ID === "ExpungeReplayMarkers");
requireTrue(artifactRule?.Status === "Enabled" && artifactRule?.Expiration?.Days > 0 && artifactRule.Expiration.Days <= 7, "aws_boundary_artifact_expiry_invalid");
requireTrue(replayRule?.Status === "Enabled" && replayRule?.Filter?.Prefix === "grant-replay/" && replayRule?.Expiration?.Days === 1, "aws_boundary_replay_expiry_invalid");
const keyId = kmsKey.split("/").at(-1);
const key = aws(["kms", "describe-key", "--key-id", keyId]).KeyMetadata;
requireTrue(key?.KeyState === "Enabled" && key?.Enabled === true && key?.MultiRegion === false, "aws_boundary_kms_key_invalid");
requireTrue(aws(["kms", "get-key-rotation-status", "--key-id", keyId]).KeyRotationEnabled === true, "aws_boundary_kms_rotation_disabled");

process.stdout.write(`${JSON.stringify({ status: "passed", stack: stackName, region, encryption: "aws:kms", public: false, artifactRetentionDays: artifactRule.Expiration.Days, replayRetentionDays: replayRule.Expiration.Days, versioning: "disabled", kmsRotation: true })}\n`);
