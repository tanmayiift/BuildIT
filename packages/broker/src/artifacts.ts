import { createHash } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { verifyArtifactGrant, type ArtifactGrant } from "@buildit/security";

type S3Command = DeleteObjectCommand | GetObjectCommand | PutObjectCommand;
type S3Sender = { send(command: S3Command): Promise<Record<string, unknown>> };
type GrantConsumer = (grantId: string, expiresAt: number) => Promise<boolean>;

export class S3GrantConsumer {
  constructor(private readonly config: { bucket: string; kmsKeyId: string; s3: S3Sender }) {}

  async consume(grantId: string, expiresAt: number) {
    const digest = createHash("sha256").update(grantId).digest("hex");
    try {
      await this.config.s3.send(new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: `grant-replay/${digest}`,
        Body: new Uint8Array(0),
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: this.config.kmsKeyId,
        IfNoneMatch: "*",
        Metadata: { "expires-at": String(expiresAt) },
      }));
      return true;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      const name = (error as { name?: string }).name;
      if (status === 412 || name === "PreconditionFailed") return false;
      throw new Error("artifact_grant_store_unavailable", { cause: error });
    }
  }
}

export class ArtifactBroker {
  readonly #s3: S3Sender;
  constructor(private readonly config: {
    bucket: string;
    kmsKeyId: string;
    grantSecret: Uint8Array;
    consumeGrant: GrantConsumer;
    region?: string;
    maxArtifactBytes?: number;
    s3?: S3Sender;
    now?: () => number;
  }) {
    if (!config.bucket || !config.kmsKeyId) throw new Error("artifact_broker_configuration_missing");
    const clientConfig: S3ClientConfig = { region: config.region ?? "eu-west-1" };
    this.#s3 = config.s3 ?? (new S3Client(clientConfig) as unknown as S3Sender);
  }

  #grant(token: string, operation: ArtifactGrant["operation"]) {
    const now = this.config.now?.();
    return verifyArtifactGrant(token, this.config.grantSecret, { operation, ...(now === undefined ? {} : { now }), consume: this.config.consumeGrant });
  }

  async put(token: string, body: Uint8Array, expectedSha256: string) {
    const max = this.config.maxArtifactBytes ?? 25_000_000;
    if (!body.byteLength || body.byteLength > max) throw new Error("artifact_size_invalid");
    const checksum = createHash("sha256").update(body).digest("hex");
    if (checksum !== expectedSha256.toLowerCase()) throw new Error("artifact_checksum_mismatch");
    const grant = await this.#grant(token, "write");
    await this.#s3.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: grant.storageKey, Body: body, ServerSideEncryption: "aws:kms", SSEKMSKeyId: this.config.kmsKeyId, ChecksumSHA256: Buffer.from(checksum, "hex").toString("base64") }));
    return { artifactId: grant.artifactId, size: body.byteLength, checksum };
  }

  async get(token: string) {
    const grant = await this.#grant(token, "read");
    const output = await this.#s3.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: grant.storageKey }));
    const max = this.config.maxArtifactBytes ?? 25_000_000;
    if (typeof output.ContentLength === "number" && output.ContentLength > max) throw new Error("artifact_size_invalid");
    const body = output.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
    if (!body?.transformToByteArray) throw new Error("artifact_body_missing");
    const bytes = await body.transformToByteArray();
    if (bytes.byteLength > max) throw new Error("artifact_size_invalid");
    return { artifactId: grant.artifactId, body: bytes, checksum: createHash("sha256").update(bytes).digest("hex") };
  }

  async delete(token: string) {
    const grant = await this.#grant(token, "delete");
    await this.#s3.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: grant.storageKey }));
    return { artifactId: grant.artifactId, deleted: true as const };
  }
}
