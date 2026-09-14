import { describe, expect, it, vi } from "vitest";
import { envelopeDecryptSecret } from "@buildit/security";
import { TrackerOAuthBroker } from "../src/tracker-oauth.js";
const kms = { async generateDataKey() { return { plaintextKey: Buffer.alloc(32, 4), encryptedKey: Buffer.from("wrapped") }; }, async decryptDataKey() { return Buffer.alloc(32, 4); }, async rewrapDataKey() { return Buffer.from("wrapped"); } };
const scope = { organizationId: "org", repositoryId: "repo", credentialScopeId: "ce744000-1337-4000-8337-ce7440001337", provider: "linear" as const };
const token = { access_token: "sensitive-access-token", refresh_token: "sensitive-refresh-token", expires_in: 3600, scope: "read" };
const config = { webOrigin: "https://buildit.test", linear: { clientId: "linear-client", clientSecret: "linear-secret" }, jira: { clientId: "jira-client", clientSecret: "jira-secret" } };
const organization = { data: { organization: { id: "linear-org", name: "Acme", urlKey: "acme" } } };
const create = (http: typeof fetch = vi.fn()) => new TrackerOAuthBroker(config, kms, "kms-1", http, () => 1000);
const state = "a".repeat(43);
describe("real tracker OAuth provider contracts", () => {
  it("reports missing provider registration without attempting a connection", () => {
    const http = vi.fn(), broker = new TrackerOAuthBroker({ webOrigin: config.webOrigin }, kms, "kms-1", http);
    expect(broker.availability()).toEqual({ linear: false, jira: false });
    expect(() => broker.begin("linear", state)).toThrow("tracker_oauth_not_configured"); expect(http).not.toHaveBeenCalled();
  });
  it("uses read access, state, PKCE and the configured callback for Linear", () => {
    const url = new URL(create().begin("linear", state));
    expect(url.origin).toBe("https://linear.app"); expect(url.searchParams.get("scope")).toBe("read");
    expect(url.searchParams.get("state")).toBe(state); expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe("https://buildit.test/setup/tracker");
    expect(url.search).not.toContain("linear-secret");
  });
  it("validates the workspace and encrypts access and refresh tokens together", async () => {
    const http = vi.fn().mockResolvedValueOnce(Response.json(token)).mockResolvedValueOnce(Response.json(organization));
    const draft = await create(http).exchange(scope, { state, code: "code" });
    expect(draft.resources).toEqual([{ id: "linear-org", name: "Acme", workspaceId: "acme" }]);
    expect(JSON.stringify(draft)).not.toContain("sensitive-");
    const stored = JSON.parse(await envelopeDecryptSecret(draft.encryptedCredential, { organizationId: "org", repositoryId: "repo", credentialId: scope.credentialScopeId, purpose: "tracker" }, kms, "kms-1"));
    expect(stored).toMatchObject({ accessToken: token.access_token, refreshToken: token.refresh_token });
    expect(http.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });
  it("rejects denied permissions and a GraphQL error returned with HTTP 200", async () => {
    await expect(create(vi.fn().mockResolvedValue(new Response(null, { status: 403 }))).exchange(scope, { state, code: "code" })).rejects.toThrow("tracker_oauth_permission_denied");
    const http = vi.fn().mockResolvedValueOnce(Response.json(token)).mockResolvedValueOnce(Response.json({ data: organization.data, errors: [{ message: "secret provider prose" }] }));
    await expect(create(http).exchange(scope, { state, code: "code" })).rejects.toThrow("tracker_oauth_provider_invalid");
  });
  it("requests Jira read permission with renewable access and preserves site selection", async () => {
    const http = vi.fn().mockResolvedValueOnce(Response.json({ ...token, scope: "read:jira-work" })).mockResolvedValueOnce(Response.json([
      { id: "cloud-one", name: "One", url: "https://one.atlassian.net", scopes: ["read:jira-work"] },
      { id: "cloud-two", name: "Two", url: "https://two.atlassian.net", scopes: ["read:jira-work"] },
    ]));
    const broker = create(http), url = new URL(broker.begin("jira", state));
    expect(url.searchParams.get("scope")).toBe("read:jira-work offline_access");
    const draft = await broker.exchange({ ...scope, provider: "jira" }, { state, code: "code" });
    expect(draft.resources).toHaveLength(2); expect(draft.resources[1]?.workspaceId).toBe("two.atlassian.net");
  });
  it("refuses project selection outside the authorized site without making that request", async () => {
    const http = vi.fn().mockResolvedValueOnce(Response.json(token)).mockResolvedValueOnce(Response.json(organization)), broker = create(http);
    const draft = await broker.exchange(scope, { state, code: "code" });
    await expect(broker.projects(scope, draft.encryptedCredential, "foreign-site")).rejects.toThrow("tracker_oauth_scope_refused");
    expect(http).toHaveBeenCalledTimes(2);
  });
  it("rotates both tokens and makes a revoked refresh grant require reconnection", async () => {
    const http = vi.fn().mockResolvedValueOnce(Response.json(token)).mockResolvedValueOnce(Response.json(organization)), broker = create(http);
    const draft = await broker.exchange(scope, { state, code: "code" });
    http.mockResolvedValueOnce(Response.json({ ...token, access_token: "rotated-access", refresh_token: "rotated-refresh" }));
    const refreshed = await broker.refresh(scope, draft.encryptedCredential);
    expect(JSON.stringify(refreshed)).not.toContain("rotated-");
    http.mockResolvedValueOnce(new Response(null, { status: 400 }));
    await expect(broker.refresh(scope, refreshed.encryptedCredential)).rejects.toThrow("tracker_oauth_reconnect_required");
  });
  it("revokes Linear through the documented token field; Jira gives the account removal path", async () => {
    const http = vi.fn().mockResolvedValueOnce(Response.json(token)).mockResolvedValueOnce(Response.json(organization)), broker = create(http);
    const draft = await broker.exchange(scope, { state, code: "code" }); http.mockResolvedValueOnce(new Response(null, { status: 200 }));
    expect(await broker.revoke(scope, draft.encryptedCredential)).toEqual({ remoteRevoked: true });
    expect(String(http.mock.calls.at(-1)?.[1]?.body)).toContain("token=sensitive-refresh-token");
  });
});

it("confirms a selected Jira project with the provider and seals that scope into the renewable credential", async () => {
 const http = vi.fn().mockResolvedValueOnce(Response.json({ ...token, scope: "read:jira-work" })).mockResolvedValueOnce(Response.json([{ id: "cloud-one", name: "One", url: "https://one.atlassian.net", scopes: ["read:jira-work"] }]));
 const broker = create(http), jiraScope = { ...scope, provider: "jira" as const }, draft = await broker.exchange(jiraScope, { state, code: "code" });
 http.mockResolvedValueOnce(Response.json({ id: "10001", key: "ENG", name: "Engineering" }));
 const result = await broker.connect(jiraScope, draft.encryptedCredential, "cloud-one", "10001");
 expect(result).toMatchObject({ workspaceId: "one.atlassian.net", projectKeys: ["ENG"], resourceId: "cloud-one" });
 expect(String(http.mock.calls.at(-1)?.[0])).toBe("https://api.atlassian.com/ex/jira/cloud-one/rest/api/3/project/10001");
 const bundle = JSON.parse(await envelopeDecryptSecret(result.encryptedCredential, { organizationId: "org", repositoryId: "repo", credentialId: scope.credentialScopeId, purpose: "tracker" }, kms, "kms-1"));
 expect(bundle).toMatchObject({ projectKeys: ["ENG"], resourceId: "cloud-one", accessToken: token.access_token, refreshToken: token.refresh_token });
 http.mockResolvedValueOnce(new Response(null, { status: 403 }));
 await expect(broker.connect(jiraScope, draft.encryptedCredential, "cloud-one", "10002")).rejects.toThrow("tracker_oauth_permission_denied");
 expect(await broker.revoke(jiraScope, result.encryptedCredential)).toMatchObject({ remoteRevoked: false, removalUrl: "https://id.atlassian.com/manage-profile/apps" });
});
