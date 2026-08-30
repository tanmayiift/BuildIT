import {
  DecryptCommand,
  GenerateDataKeyCommand,
  KMSClient,
  ReEncryptCommand,
  type KMSClientConfig,
} from "@aws-sdk/client-kms";
import type { KmsClient, KmsContext } from "./index";

type CommandSender = Pick<KMSClient, "send">;

function requiredBytes(value: Uint8Array | undefined, field: string): Uint8Array {
  if (!value?.byteLength) throw new Error(`kms_missing_${field}`);
  return value;
}

export class AwsKmsClient implements KmsClient {
  readonly #client: CommandSender;

  constructor(config: KMSClientConfig | CommandSender = { region: "eu-west-1" }) {
    this.#client = "send" in config ? config : new KMSClient({ ...config, region: config.region ?? "eu-west-1" });
  }

  async generateDataKey(input: { keyId: string; encryptionContext: KmsContext }) {
    const output = await this.#client.send(new GenerateDataKeyCommand({
      KeyId: input.keyId,
      KeySpec: "AES_256",
      EncryptionContext: input.encryptionContext,
    }));
    return {
      plaintextKey: requiredBytes(output.Plaintext, "plaintext_key"),
      encryptedKey: requiredBytes(output.CiphertextBlob, "wrapped_key"),
    };
  }

  async decryptDataKey(input: { keyId: string; encryptedKey: Uint8Array; encryptionContext: KmsContext }) {
    const output = await this.#client.send(new DecryptCommand({
      KeyId: input.keyId,
      CiphertextBlob: input.encryptedKey,
      EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
      EncryptionContext: input.encryptionContext,
    }));
    return requiredBytes(output.Plaintext, "plaintext_key");
  }

  async rewrapDataKey(input: { sourceKeyId: string; destinationKeyId: string; encryptedKey: Uint8Array; encryptionContext: KmsContext }) {
    const output = await this.#client.send(new ReEncryptCommand({
      SourceKeyId: input.sourceKeyId,
      DestinationKeyId: input.destinationKeyId,
      CiphertextBlob: input.encryptedKey,
      SourceEncryptionAlgorithm: "SYMMETRIC_DEFAULT",
      DestinationEncryptionAlgorithm: "SYMMETRIC_DEFAULT",
      SourceEncryptionContext: input.encryptionContext,
      DestinationEncryptionContext: input.encryptionContext,
    }));
    return requiredBytes(output.CiphertextBlob, "rewrapped_key");
  }
}
