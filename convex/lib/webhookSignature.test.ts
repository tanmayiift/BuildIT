import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validSignature } from "./webhookSignature";

// This is the check that actually guards the GitHub webhook endpoint. It had no test: the tested
// implementation was a second one in packages/github whose only importer was its own test.
const secret = "webhook-secret";
const body = new TextEncoder().encode('{"action":"opened","number":7}');
const sign = (bytes: Uint8Array, key = secret) => `sha256=${createHmac("sha256", key).update(Buffer.from(bytes)).digest("hex")}`;

describe("GitHub webhook signature", () => {
  it("accepts a signature over the exact raw bytes", async () => {
    await expect(validSignature(body.buffer as ArrayBuffer, sign(body), secret)).resolves.toBe(true);
  });

  it("rejects a body changed by a single byte", async () => {
    const tampered = new Uint8Array(body); tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 1;
    await expect(validSignature(tampered.buffer as ArrayBuffer, sign(body), secret)).resolves.toBe(false);
  });

  it("rejects a signature changed by a single hex digit", async () => {
    const signature = sign(body);
    const flipped = `${signature.slice(0, -1)}${signature.at(-1) === "0" ? "1" : "0"}`;
    await expect(validSignature(body.buffer as ArrayBuffer, flipped, secret)).resolves.toBe(false);
  });

  it("rejects a signature made with another secret", async () => {
    await expect(validSignature(body.buffer as ArrayBuffer, sign(body, "someone-elses-secret"), secret)).resolves.toBe(false);
  });

  // Length, prefix and alphabet are checked before any HMAC work, so a malformed header can never
  // reach the comparison and can never be padded into a match.
  it("rejects a malformed header outright", async () => {
    for (const header of ["", "sha256=", "sha1=" + "a".repeat(40), "sha256=" + "a".repeat(63), "sha256=" + "a".repeat(65), "sha256=" + "z".repeat(64), "a".repeat(64)]) {
      await expect(validSignature(body.buffer as ArrayBuffer, header, secret)).resolves.toBe(false);
    }
  });

  it("accepts an uppercase hex signature, as the header is case-insensitive", async () => {
    await expect(validSignature(body.buffer as ArrayBuffer, sign(body).toUpperCase().replace("SHA256", "sha256"), secret)).resolves.toBe(true);
  });

  it("signs an empty body correctly rather than short-circuiting", async () => {
    const empty = new Uint8Array(0);
    await expect(validSignature(empty.buffer as ArrayBuffer, sign(empty), secret)).resolves.toBe(true);
    await expect(validSignature(empty.buffer as ArrayBuffer, sign(body), secret)).resolves.toBe(false);
  });
});
