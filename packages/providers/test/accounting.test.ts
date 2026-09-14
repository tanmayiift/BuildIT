import { describe, expect, it } from "vitest";
import { ProviderClient } from "../src/index.js";

const request = { model: "gemini-2.5-pro", system: "policy", input: "data", schemaName: "result",
  schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false }, maxOutputTokens: 100 };
const allowlist = new Set([request.model]);

describe("provider accounting retains the work paid for", () => {
  it("includes Gemini thinking tokens in generated usage", async () => {
    const client = new ProviderClient(async () => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"ok":true}' }] } }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5, thoughtsTokenCount: 80 } }));
    expect(await client.generate("gemini", "test", request, allowlist)).toMatchObject({ inputTokens: 20, outputTokens: 85, usageKnown: true });
  });
  it("retains usage even when a paid response is truncated", async () => {
    const client = new ProviderClient(async () => Response.json({ candidates: [{ finishReason: "MAX_TOKENS" }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 0, thoughtsTokenCount: 100 } }));
    await expect(client.generate("gemini", "test", request, allowlist)).rejects.toMatchObject({ code: "truncated", usage: { inputTokens: 20, outputTokens: 100, usageKnown: true } });
  });
  it("does not turn missing usage into a trusted zero", async () => {
    const client = new ProviderClient(async () => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"ok":true}' }] } }] }));
    expect(await client.generate("gemini", "test", request, allowlist)).toMatchObject({ usageKnown: false });
  });
});
