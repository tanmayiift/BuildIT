import { createHash } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { issueArtifactGrant } from "@buildit/security";
import { ArtifactBroker } from "../src/artifacts";

const secret = new Uint8Array(32).fill(5), now = 1_000;
type Command = DeleteObjectCommand | GetObjectCommand | PutObjectCommand;
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

  it("deletes the exact granted key", async () => {
    const send = vi.fn(async (_command: Command) => ({})), { value } = broker(send);
    await expect(value.delete(issueArtifactGrant({ ...base, operation: "delete" }, secret, now))).resolves.toEqual({ artifactId: "artifact-a", deleted: true });
    expect(send.mock.calls[0]![0]).toBeInstanceOf(DeleteObjectCommand);
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
