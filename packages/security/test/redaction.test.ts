import { describe, expect, it } from "vitest";
import { redact, redactForModel } from "../src/index.js";

// Every one of these was measured against the shipped build and passed through in cleartext, on a
// path that reaches Anthropic, OpenAI and Google, and then report.md - which is posted as a public
// pull request comment.
// Assembled at runtime rather than written as literals. A correctly shaped token in a source file
// is indistinguishable from a real one to a secret scanner - GitHub's push protection blocked this
// very file - and a fixture that cannot be committed is a fixture that stops running.
const join = (...parts: string[]) => parts.join("");
// Assembled for the same reason: a PEM header written out is what the scanner looks for.
const pem = (label: string) => join("-----", "BEGIN ", label, "PRIVATE KEY", "-----\n", "MIIEvQIBADANBg\n", "-----", "END ", label, "PRIVATE KEY", "-----");
const secrets: Array<[string, string]> = [
  ["GitHub fine-grained PAT", join("github", "_pat_", "11ABCDEFG0", "a".repeat(50))],
  ["classic OpenAI key", join("sk", "-", "A1b2C3d4".repeat(6))],
  ["Slack bot token", join("xox", "b-", "123456789012", "-1234567890123-", "AbCdEfGhIjKlMnOpQrStUvWx")],
  ["Stripe live key", join("sk", "_live_", "A1b2C3d4".repeat(4))],
  ["Postgres connection string", join("postgres://appuser:", "sup3rs3cretpw", "@db.internal:5432/production")],
  ["raw JWT", join("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", ".", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", ".", "dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk")],
  ["unlabeled PKCS#8 key", pem("")],
  // Controls: these were already caught and must stay caught.
  ["Anthropic key", join("sk", "-ant-", "A1b2C3d4".repeat(4))],
  ["GitHub server token", join("gh", "s_", "A1b2C3d4".repeat(4))],
  ["AWS access key id", join("AKIA", "IOSFODNN7", "EXAMPLE")],
  ["Google API key", join("AIza", "A1b2C3d4".repeat(5))],
  ["RSA private key", pem("RSA ")],
];

describe("secret redaction", () => {
  for (const [name, secret] of secrets) {
    it(`removes a ${name} from CI output`, () => {
      const line = `error: request failed with ${secret} in the header`;
      expect(redact(line)).not.toContain(secret);
      expect(redact(line)).toContain("[REDACTED]");
    });

    it(`removes a ${name} from model input`, () => {
      const line = `error: request failed with ${secret} in the header`;
      expect(redactForModel(line)).not.toContain(secret);
    });
  }

  // The two helpers drifted apart in one file: redactForModel made the PEM label optional and
  // redact never followed. They share one pattern list now, so drift cannot recur silently.
  it("catches the same formats in both helpers", () => {
    for (const [, secret] of secrets) {
      expect(redact(secret).includes(secret)).toBe(redactForModel(secret).includes(secret));
    }
  });

  // A finding cites an inspectable line range, so a redaction must not move the lines under it.
  it("preserves line count when redacting for a model", () => {
    const key = pem("").replace("MIIEvQIBADANBg\n", "MIIEvQIBADANBg\nAAAA\n");
    const document = `line one\n${key}\nlast line`;
    expect(redactForModel(document).split("\n")).toHaveLength(document.split("\n").length);
  });

  it("leaves ordinary code alone", () => {
    const source = 'const label = "sk-short"; // token: abc\nexport const timeout = 30_000;';
    expect(redact(source)).toBe(source);
  });
});
