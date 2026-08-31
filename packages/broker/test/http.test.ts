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

  it("can report the thrown failure to a trusted caller without expanding the response", async () => {
    const f = fixture(), onFailure = vi.fn();
    f.authorize.mockRejectedValue(new Error("credential_store_unavailable"));
    const response = await handleCredentialSave(request({ organizationId: "organization-a", provider: "gemini", apiKey: "secret-provider-key-1234" }), { allowedOrigin: origin, authorize: f.authorize, broker: f.broker as never, onFailure });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "credential_save_failed" });
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ message: "credential_authorization_failed" }));
  });

  it("labels persistence separately for trusted diagnostics while keeping the browser response generic", async () => {
    const f = fixture(), onFailure = vi.fn();
    f.broker.save.mockRejectedValue(new Error("kms detail that must not reach the browser"));
    const response = await handleCredentialSave(request({ organizationId: "organization-a", provider: "gemini", apiKey: "secret-provider-key-1234" }), { allowedOrigin: origin, authorize: f.authorize, broker: f.broker as never, onFailure });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "credential_save_failed" });
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ message: "credential_persistence_failed" }));
  });

  it("returns a stable 429 before provider validation when the tenant limit is reached", async () => {
    const f = fixture(); f.authorize.mockRejectedValue(new Error("rate_limited"));
    const response = await handleCredentialSave(request({ organizationId: "organization-a", provider: "gemini", apiKey: "secret-provider-key-1234" }), { allowedOrigin: origin, authorize: f.authorize, broker: f.broker as never });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limited" });
    expect(f.broker.save).not.toHaveBeenCalled();
  });

  it("exposes a version receipt and distinguishes an existing credential scope", async () => {
    const f = fixture(); f.broker.save.mockRejectedValue(new Error("credential_scope_already_exists"));
    const response = await handleCredentialSave(request({ organizationId: "organization-a", provider: "gemini", apiKey: "secret-provider-key-1234" }), { allowedOrigin: origin, authorize: f.authorize, broker: f.broker as never });
    expect(response.status).toBe(409);
    expect(response.headers.get("x-buildit-credential-contract")).toBe("2026-08-30.1");
    expect(response.headers.get("access-control-expose-headers")).toContain("x-buildit-credential-contract");
    expect(await response.json()).toEqual({ error: "credential_scope_already_exists" });
  });

  it("forwards an explicit replacement ID without changing tenant authorization", async () => {
    const f = fixture();
    const response = await handleCredentialSave(request({ organizationId: "organization-a", provider: "openai", apiKey: "secret-provider-key-1234", replacesCredentialId: "credential-old" }), { allowedOrigin: origin, authorize: f.authorize, broker: f.broker as never });
    expect(response.status).toBe(201);
    expect(f.broker.save).toHaveBeenCalledWith(expect.objectContaining({ replacesCredentialId: "credential-old", organizationId: "organization-a" }));
  });
});
