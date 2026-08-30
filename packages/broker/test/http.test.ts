import { describe, expect, it, vi } from "vitest";
import { handleCredentialSave } from "../src/http";

const origin = "https://buildit-agentic-review.vercel.app";
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://broker.example/api/credentials", { method: "POST", headers: {
    origin, authorization: "Bearer signed-user-token", "content-type": "application/json", ...headers,
  }, body: JSON.stringify(body) });
}
function fixture() {
  return {
    authorize: vi.fn(async () => ({ actorId: "user-a" })),
    broker: { save: vi.fn(async () => ({ id: "credential-a", provider: "gemini", maskedSuffix: "1234", status: "valid", lastValidatedAt: 1 })) },
  };
}

describe("credential broker HTTP boundary", () => {
  it("authorizes the exact tenant before validating and encrypting the key", async () => {
    const f = fixture();
    const response = await handleCredentialSave(request({ organizationId: "organization-a", repositoryId: "repository-a", provider: "gemini", apiKey: "secret-provider-key-1234" }), { allowedOrigin: origin, authorize: f.authorize, broker: f.broker as never });
    expect(response.status).toBe(201);
    expect(f.authorize).toHaveBeenCalledWith({ token: "signed-user-token", organizationId: "organization-a", repositoryId: "repository-a" });
    expect(f.broker.save).toHaveBeenCalledWith(expect.objectContaining({ actorId: "user-a", apiKey: "secret-provider-key-1234" }));
    expect(await response.text()).not.toContain("secret-provider-key");
  });

  it("rejects foreign origins, missing tokens, extra fields, and oversized bodies before the broker", async () => {
    const f = fixture(), valid = { organizationId: "organization-a", provider: "openai", apiKey: "secret-provider-key-1234" };
    const deps = { allowedOrigin: origin, authorize: f.authorize, broker: f.broker as never };
    expect((await handleCredentialSave(new Request("https://broker.example", { method: "POST", headers: { origin: "https://evil.example" }, body: JSON.stringify(valid) }), deps)).status).toBe(403);
    expect((await handleCredentialSave(request(valid, { authorization: "" }), deps)).status).toBe(401);
    expect((await handleCredentialSave(request({ ...valid, admin: true }), deps)).status).toBe(400);
    expect((await handleCredentialSave(request(valid, { "content-length": "20000" }), deps)).status).toBe(413);
    expect(f.broker.save).not.toHaveBeenCalled();
  });

  it("returns only stable errors and never leaks provider or database details", async () => {
    const f = fixture(); f.authorize.mockRejectedValue(new Error("database connection included a-secret-provider-key"));
    const response = await handleCredentialSave(request({ organizationId: "organization-a", provider: "anthropic", apiKey: "secret-provider-key-1234" }), { allowedOrigin: origin, authorize: f.authorize, broker: f.broker as never });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "credential_save_failed" });
  });

  it("returns a stable 429 before provider validation when the tenant limit is reached", async () => {
    const f = fixture(); f.authorize.mockRejectedValue(new Error("rate_limited"));
    const response = await handleCredentialSave(request({ organizationId: "organization-a", provider: "gemini", apiKey: "secret-provider-key-1234" }), { allowedOrigin: origin, authorize: f.authorize, broker: f.broker as never });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limited" });
    expect(f.broker.save).not.toHaveBeenCalled();
  });
});
