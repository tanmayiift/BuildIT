import { createHash } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { issueArtifactGrant } from "@buildit/security";
import { ArtifactBroker, S3GrantConsumer } from "../src/artifacts";

const secret = new Uint8Array(32).fill(5), now = 1_000;
type Command = DeleteObjectCommand | GetObjectCommand | HeadObjectCommand | PutObjectCommand;
const base = { organizationId: "org-a", repositoryId: "repo-a", reviewId: "review-a", artifactId: "artifact-a", storageKey: "artifacts/org-a/repo-a/review-a/artifact-a/content.bin" };
function broker(send: ReturnType<typeof vi.fn>, consume = vi.fn(async () => true)) { return { value: new ArtifactBroker({ bucket: "bucket", kmsKeyId: "kms-key", grantSecret: secret, consumeGrant: consume, now: () => 2_000, s3: { send } }), consume }; }

describe("artifact broker", () => {
  it("writes only with the configured KMS key and verified checksum", async () => {
    const send = vi.fn(async (_command: Command) => ({})), { value } = broker(send), body = new Uint8Array([1, 2, 3]);
    const checksum = createHash("sha256").update(body).digest("hex"), token = issueArtifactGrant({ ...base, operation: "write" }, secret, now);
    await expect(value.put(token, body, checksum)).resolves.toMatchObject({ artifactId: "artifact-a", size: 3, checksum });
    const command = send.mock.calls[0]![0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({ Bucket: "bucket", Key: base.storageKey, ServerSideEncryption: "aws:kms", SSEKMSKeyId: "kms-key" });
  });

  it("reads one bounded artifact without returning a storage URL", async () => {
    const send = vi.fn(async (_command: Command) => ({ ContentLength: 3, Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } })), { value } = broker(send);
    const result = await value.get(issueArtifactGrant({ ...base, operation: "read" }, secret, now));
    expect(result.body).toEqual(new Uint8Array([1, 2, 3]));
    expect(result).not.toHaveProperty("url");
    expect(send.mock.calls[0]![0]).toBeInstanceOf(GetObjectCommand);
  });

  it("deletes the exact granted key and confirms it is gone", async () => {
    const notFound = Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
    const send = vi.fn(async (command: Command) => { if (command instanceof HeadObjectCommand) throw notFound; return {}; });
    const { value } = broker(send);
    await expect(value.delete(issueArtifactGrant({ ...base, operation: "delete" }, secret, now))).resolves.toEqual({ artifactId: "artifact-a", deleted: true });
    expect(send.mock.calls[0]![0]).toBeInstanceOf(DeleteObjectCommand);
    const head = send.mock.calls[1]![0] as HeadObjectCommand;
    expect(head).toBeInstanceOf(HeadObjectCommand);
    expect(head.input).toMatchObject({ Bucket: "bucket", Key: base.storageKey });
  });

  it("refuses to report a deletion the bucket still answers for", async () => {
    // The exact silent failure: a delete that a bucket policy or object lock did not honour.
    const send = vi.fn(async (_command: Command) => ({ ContentLength: 3 })), { value } = broker(send);
    await expect(value.delete(issueArtifactGrant({ ...base, operation: "delete" }, secret, now))).rejects.toThrow("artifact_delete_unconfirmed");
  });

  // A throttle or a permissions error is not evidence of absence and must not read as deleted.
  it("refuses when the confirming read fails for any reason other than absence", async () => {
    const denied = Object.assign(new Error("AccessDenied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
    const send = vi.fn(async (command: Command) => { if (command instanceof HeadObjectCommand) throw denied; return {}; });
    const { value } = broker(send);
    await expect(value.delete(issueArtifactGrant({ ...base, operation: "delete" }, secret, now))).rejects.toThrow("artifact_delete_unconfirmed");
  });

  it("rejects checksum, size, and replay before broadening access", async () => {
    const send = vi.fn(async (_command: Command) => ({})), { value } = broker(send, vi.fn(async () => false));
    const token = issueArtifactGrant({ ...base, operation: "write" }, secret, now);
    await expect(value.put(token, new Uint8Array([1]), "0".repeat(64))).rejects.toThrow("artifact_checksum_mismatch");
    const checksum = createHash("sha256").update(new Uint8Array([1])).digest("hex");
    await expect(value.put(token, new Uint8Array([1]), checksum)).rejects.toThrow("artifact_grant_replayed");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("durable grant replay guard", () => {
  it("creates one encrypted conditional marker and accepts it", async () => {
    const send = vi.fn(async (_command: Command) => ({}));
    const consumer = new S3GrantConsumer({ bucket: "bucket", kmsKeyId: "kms-key", s3: { send } });
    await expect(consumer.consume("grant-a", 3_000)).resolves.toBe(true);
    const command = send.mock.calls[0]![0] as PutObjectCommand;
    expect(command.input).toMatchObject({ Bucket: "bucket", IfNoneMatch: "*", ServerSideEncryption: "aws:kms", SSEKMSKeyId: "kms-key", Metadata: { "expires-at": "3000" } });
    expect(command.input.Key).toMatch(/^grant-replay\/[0-9a-f]{64}$/);
  });

  it("treats an existing marker as replay and hides storage failures", async () => {
    const replay = new S3GrantConsumer({ bucket: "bucket", kmsKeyId: "kms-key", s3: { send: vi.fn(async () => { throw { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } }; }) } });
    await expect(replay.consume("grant-a", 3_000)).resolves.toBe(false);
    const unavailable = new S3GrantConsumer({ bucket: "bucket", kmsKeyId: "kms-key", s3: { send: vi.fn(async () => { throw new Error("raw aws error"); }) } });
    await expect(unavailable.consume("grant-a", 3_000)).rejects.toThrow("artifact_grant_store_unavailable");
  });
});
