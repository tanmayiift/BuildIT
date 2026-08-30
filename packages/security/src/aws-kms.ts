import {
  DecryptCommand,
  GenerateDataKeyCommand,
  KMSClient,
  ReEncryptCommand,
  type KMSClientConfig,
} from "@aws-sdk/client-kms";
import type { KmsClient, KmsContext } from "./index.js";

type CommandSender = { send(command: unknown): Promise<unknown> };

function requiredBytes(value: Uint8Array | undefined, field: string): Uint8Array {
  if (!value?.byteLength) throw new Error(`kms_missing_${field}`);
  return value;
}

export class AwsKmsClient implements KmsClient {
  readonly #send: CommandSender["send"];

  constructor(options: { config?: KMSClientConfig; client?: CommandSender } = {}) {
    const client: CommandSender = options.client ?? (new KMSClient({ region: "eu-west-1", ...options.config }) as unknown as CommandSender);
    this.#send = command => client.send(command as never);
  }

  async generateDataKey(input: { keyId: string; encryptionContext: KmsContext }) {
    const output = await this.#send(new GenerateDataKeyCommand({
      KeyId: input.keyId,
      KeySpec: "AES_256",
      EncryptionContext: input.encryptionContext,
    })) as { Plaintext?: Uint8Array; CiphertextBlob?: Uint8Array };
    return {
      plaintextKey: requiredBytes(output.Plaintext, "plaintext_key"),
      encryptedKey: requiredBytes(output.CiphertextBlob, "wrapped_key"),
    };
  }

  async decryptDataKey(input: { keyId: string; encryptedKey: Uint8Array; encryptionContext: KmsContext }) {
    const output = await this.#send(new DecryptCommand({
      KeyId: input.keyId,
      CiphertextBlob: input.encryptedKey,
      EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
      EncryptionContext: input.encryptionContext,
    })) as { Plaintext?: Uint8Array };
    return requiredBytes(output.Plaintext, "plaintext_key");
  }

  async rewrapDataKey(input: { sourceKeyId: string; destinationKeyId: string; encryptedKey: Uint8Array; encryptionContext: KmsContext }) {
    const output = await this.#send(new ReEncryptCommand({
      SourceKeyId: input.sourceKeyId,
      DestinationKeyId: input.destinationKeyId,
      CiphertextBlob: input.encryptedKey,
      SourceEncryptionAlgorithm: "SYMMETRIC_DEFAULT",
      DestinationEncryptionAlgorithm: "SYMMETRIC_DEFAULT",
      SourceEncryptionContext: input.encryptionContext,
      DestinationEncryptionContext: input.encryptionContext,
    })) as { CiphertextBlob?: Uint8Array };
    return requiredBytes(output.CiphertextBlob, "rewrapped_key");
  }
}
