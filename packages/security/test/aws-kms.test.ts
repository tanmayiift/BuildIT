import { DecryptCommand, GenerateDataKeyCommand, ReEncryptCommand } from "@aws-sdk/client-kms";
import { describe, expect, it, vi } from "vitest";
import { AwsKmsClient, type KmsContext } from "../src/index";

const context: KmsContext = {
  organizationId: "org-a",
  repositoryId: "repo-a",
  credentialId: "credential-a",
  purpose: "model-provider",
};

describe("AWS KMS adapter", () => {
  it("generates an AES-256 data key with the complete tenant context", async () => {
    const send = vi.fn().mockResolvedValue({ Plaintext: new Uint8Array(32).fill(1), CiphertextBlob: new Uint8Array([2]) });
    const kms = new AwsKmsClient({ client: { send } });
    await expect(kms.generateDataKey({ keyId: "key-a", encryptionContext: context })).resolves.toMatchObject({ encryptedKey: new Uint8Array([2]) });
    const command = send.mock.calls[0]![0] as GenerateDataKeyCommand;
    expect(command).toBeInstanceOf(GenerateDataKeyCommand);
    expect(command.input).toEqual({ KeyId: "key-a", KeySpec: "AES_256", EncryptionContext: context });
  });

  it("decrypts only with the original key and tenant context", async () => {
    const send = vi.fn().mockResolvedValue({ Plaintext: new Uint8Array(32).fill(3) });
    const kms = new AwsKmsClient({ client: { send } });
    await kms.decryptDataKey({ keyId: "key-a", encryptedKey: new Uint8Array([2]), encryptionContext: context });
    const command = send.mock.calls[0]![0] as DecryptCommand;
    expect(command.input.KeyId).toBe("key-a");
    expect(command.input.EncryptionContext).toEqual(context);
    expect(command.input.EncryptionAlgorithm).toBe("SYMMETRIC_DEFAULT");
  });

  it("rewraps without requesting the plaintext data key", async () => {
    const send = vi.fn().mockResolvedValue({ CiphertextBlob: new Uint8Array([4]) });
    const kms = new AwsKmsClient({ client: { send } });
    await expect(kms.rewrapDataKey({ sourceKeyId: "key-a", destinationKeyId: "key-b", encryptedKey: new Uint8Array([2]), encryptionContext: context })).resolves.toEqual(new Uint8Array([4]));
    const command = send.mock.calls[0]![0] as ReEncryptCommand;
    expect(command.input.SourceEncryptionContext).toEqual(context);
    expect(command.input.DestinationEncryptionContext).toEqual(context);
  });

  it("fails closed when KMS omits key material", async () => {
    const kms = new AwsKmsClient({ client: { send: vi.fn().mockResolvedValue({}) } });
    await expect(kms.generateDataKey({ keyId: "key-a", encryptionContext: context })).rejects.toThrow("kms_missing_plaintext_key");
    await expect(kms.decryptDataKey({ keyId: "key-a", encryptedKey: new Uint8Array([2]), encryptionContext: context })).rejects.toThrow("kms_missing_plaintext_key");
  });
});
