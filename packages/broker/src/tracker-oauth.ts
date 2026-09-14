import { createHash, createHmac } from "node:crypto";
import { credentialAad, envelopeDecryptSecret, envelopeEncryptSecret, type EnvelopeCiphertext, type KmsClient } from "@buildit/security";
export type OAuthTrackerProvider = "linear" | "jira";
export type TrackerOAuthScope = { organizationId: string; repositoryId?: string; credentialScopeId: string; provider: OAuthTrackerProvider };
export type TrackerOAuthResource = { id: string; name: string; workspaceId: string };
export type TrackerOAuthEnvelope = EnvelopeCiphertext & { aadDigest: string };
export type TrackerOAuthDraft = { encryptedCredential: TrackerOAuthEnvelope; resources: TrackerOAuthResource[]; scopes: string[]; tokenExpiresAt: number };
export type TrackerOAuthConfig = { webOrigin: string; linear?: { clientId: string; clientSecret: string }; jira?: { clientId: string; clientSecret: string } };
type Http = (input: string | URL, init?: RequestInit) => Promise<Response>;
type Bundle = { format: "oauth_bundle_v1"; provider: OAuthTrackerProvider; accessToken: string; refreshToken: string; expiresAt: number; scopes: string[]; resources: TrackerOAuthResource[]; resourceId?: string; projectKeys?: string[] };
export type TrackerOAuthProject = { id: string; key: string; name: string };
const jiraHost = /^[a-z0-9][a-z0-9-]{0,61}\.atlassian\.net$/i;
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const name = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 300;
const record = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("tracker_oauth_provider_invalid"); return value as Record<string, unknown>; };
const aadScope = (scope: TrackerOAuthScope) => ({ organizationId: scope.organizationId, ...(scope.repositoryId ? { repositoryId: scope.repositoryId } : {}), credentialId: scope.credentialScopeId, purpose: "tracker" as const });

export class TrackerOAuthBroker {
  private readonly callback: string;
  constructor(private readonly config: TrackerOAuthConfig, private readonly kms: KmsClient, private readonly kmsKeyId: string, private readonly http: Http = fetch, private readonly now = () => Date.now()) {
    const origin = new URL(config.webOrigin);
    if (origin.protocol !== "https:" || origin.origin !== config.webOrigin || origin.username || origin.password) throw new Error("tracker_oauth_configuration_missing");
    this.callback = `${origin.origin}/setup/tracker`;
  }
  availability() { return { linear: Boolean(this.config.linear?.clientId && this.config.linear.clientSecret), jira: Boolean(this.config.jira?.clientId && this.config.jira.clientSecret) }; }
  private client(provider: OAuthTrackerProvider) { const client = this.config[provider]; if (!client?.clientId || !client.clientSecret) throw new Error("tracker_oauth_not_configured"); return client; }
  private verifier(state: string) { return createHmac("sha256", this.client("linear").clientSecret).update(`buildit-tracker-pkce:${state}`).digest("base64url"); }
  begin(provider: OAuthTrackerProvider, state: string) {
    const client = this.client(provider);
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(state)) throw new Error("tracker_oauth_state_invalid");
    const url = new URL(provider === "linear" ? "https://linear.app/oauth/authorize" : "https://auth.atlassian.com/authorize");
    url.searchParams.set("client_id", client.clientId); url.searchParams.set("redirect_uri", this.callback); url.searchParams.set("response_type", "code"); url.searchParams.set("state", state); url.searchParams.set("prompt", "consent");
    url.searchParams.set("scope", provider === "linear" ? "read" : "read:jira-work offline_access");
    if (provider === "jira") url.searchParams.set("audience", "api.atlassian.com");
    else { url.searchParams.set("code_challenge", createHash("sha256").update(this.verifier(state)).digest("base64url")); url.searchParams.set("code_challenge_method", "S256"); }
    return url.toString();
  }
  private async request(url: string, init: RequestInit, refreshing = false): Promise<unknown> {
    let response: Response;
    try { response = await this.http(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(10_000) }); } catch { throw new Error("tracker_oauth_unavailable"); }
    if (refreshing && [400, 401, 403].includes(response.status)) throw new Error("tracker_oauth_reconnect_required");
    if ([401, 403].includes(response.status)) throw new Error("tracker_oauth_permission_denied");
    if (!response.ok) throw new Error(response.status === 429 ? "tracker_oauth_rate_limited" : "tracker_oauth_unavailable");
    const raw = await response.text(); if (Buffer.byteLength(raw) > 512_000) throw new Error("tracker_oauth_provider_invalid");
    try { return JSON.parse(raw); } catch { throw new Error("tracker_oauth_provider_invalid"); }
  }
  private async token(provider: OAuthTrackerProvider, fields: Record<string, string>, refreshing = false) {
    const client = this.client(provider), body = { client_id: client.clientId, client_secret: client.clientSecret, ...fields };
    const result = record(await this.request(provider === "linear" ? "https://api.linear.app/oauth/token" : "https://auth.atlassian.com/oauth/token", { method: "POST", headers: { "content-type": provider === "linear" ? "application/x-www-form-urlencoded" : "application/json" }, body: provider === "linear" ? new URLSearchParams(body).toString() : JSON.stringify(body) }, refreshing));
    const scopes = Array.isArray(result.scope) ? result.scope : typeof result.scope === "string" ? result.scope.split(/[ ,]+/).filter(Boolean) : [];
    if (!scopes.includes(provider === "linear" ? "read" : "read:jira-work")) throw new Error("tracker_oauth_permission_denied");
    if (typeof result.access_token !== "string" || result.access_token.length < 8 || result.access_token.length > 16384 || typeof result.refresh_token !== "string" || result.refresh_token.length < 8 || result.refresh_token.length > 16384 || typeof result.expires_in !== "number" || !Number.isFinite(result.expires_in) || result.expires_in <= 0 || result.expires_in > 604800 || scopes.some(item => typeof item !== "string")) throw new Error("tracker_oauth_provider_invalid");
    return { accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: this.now() + result.expires_in * 1000, scopes: scopes as string[] };
  }
  private async linear(token: string, query: string, variables?: Record<string, unknown>) {
    const body = record(await this.request("https://api.linear.app/graphql", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ query, ...(variables ? { variables } : {}) }) }));
    if (Array.isArray(body.errors) && body.errors.length) throw new Error("tracker_oauth_provider_invalid");
    return record(body.data);
  }
  private async resources(provider: OAuthTrackerProvider, accessToken: string): Promise<TrackerOAuthResource[]> {
    if (provider === "linear") {
      const org = record((await this.linear(accessToken, "query BuildITOrganization { organization { id name urlKey } }")).organization);
      if (!identifier(org.id) || !name(org.name) || !identifier(org.urlKey)) throw new Error("tracker_oauth_provider_invalid");
      return [{ id: org.id, name: org.name, workspaceId: org.urlKey }];
    }
    const resources = await this.request("https://api.atlassian.com/oauth/token/accessible-resources", { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } });
    if (!Array.isArray(resources) || resources.length > 100) throw new Error("tracker_oauth_provider_invalid");
    const found: TrackerOAuthResource[] = [];
    for (const raw of resources) {
      const item = record(raw); if (!Array.isArray(item.scopes) || !item.scopes.includes("read:jira-work")) continue;
      let url: URL; try { url = new URL(String(item.url)); } catch { throw new Error("tracker_oauth_provider_invalid"); }
      if (!identifier(item.id) || !name(item.name) || url.protocol !== "https:" || !jiraHost.test(url.hostname) || url.port || url.username || url.password || !["", "/"].includes(url.pathname) || url.search || url.hash) throw new Error("tracker_oauth_provider_invalid");
      found.push({ id: item.id, name: item.name, workspaceId: url.hostname.toLowerCase() });
    }
    if (!found.length) throw new Error("tracker_oauth_permission_denied");
    return found;
  }
  private async seal(scope: TrackerOAuthScope, value: Bundle): Promise<TrackerOAuthEnvelope> {
    const context = aadScope(scope), envelope = await envelopeEncryptSecret(JSON.stringify(value), context, this.kms, this.kmsKeyId);
    return { ...envelope, aadDigest: createHash("sha256").update(credentialAad(context)).digest("hex") };
  }
  private async open(scope: TrackerOAuthScope, envelope: TrackerOAuthEnvelope): Promise<Bundle> {
    const context = aadScope(scope);
    if (createHash("sha256").update(credentialAad(context)).digest("hex") !== envelope.aadDigest) throw new Error("tracker_oauth_scope_refused");
    const value = record(JSON.parse(await envelopeDecryptSecret(envelope, context, this.kms, this.kmsKeyId))) as unknown as Bundle;
    if (value.format !== "oauth_bundle_v1" || value.provider !== scope.provider || !Array.isArray(value.resources) || !value.accessToken || !value.refreshToken) throw new Error("tracker_oauth_provider_invalid");
    return value;
  }
  async exchange(scope: TrackerOAuthScope, input: { state: string; code: string }): Promise<TrackerOAuthDraft> {
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(input.state) || !input.code || input.code.length > 4096) throw new Error("tracker_oauth_state_invalid");
    const token = await this.token(scope.provider, { grant_type: "authorization_code", code: input.code, redirect_uri: this.callback, ...(scope.provider === "linear" ? { code_verifier: this.verifier(input.state) } : {}) });
    const resources = await this.resources(scope.provider, token.accessToken), bundle: Bundle = { ...token, resources, provider: scope.provider, format: "oauth_bundle_v1" };
    return { encryptedCredential: await this.seal(scope, bundle), resources, scopes: token.scopes, tokenExpiresAt: token.expiresAt };
  }
  private resource(bundle: Bundle, resourceId: string) { const item = bundle.resources.find(resource => resource.id === resourceId); if (!item) throw new Error("tracker_oauth_scope_refused"); return item; }
  async projects(scope: TrackerOAuthScope, envelope: TrackerOAuthEnvelope, resourceId: string, cursor = "") {
    const bundle = await this.open(scope, envelope); this.resource(bundle, resourceId);
    if (bundle.expiresAt <= this.now()) throw new Error("tracker_oauth_reconnect_required");
    if (scope.provider === "linear") {
      if (cursor.length > 300) throw new Error("tracker_oauth_scope_refused");
      const teams = record((await this.linear(bundle.accessToken, "query BuildITTeams($after:String){ teams(first:50,after:$after){ nodes { id key name } pageInfo { hasNextPage endCursor } } }", { after: cursor || null })).teams);
      const nodes = teams.nodes; if (!Array.isArray(nodes) || nodes.length > 50) throw new Error("tracker_oauth_provider_invalid");
      const page = record(teams.pageInfo);
      return { projects: nodes.map(item => this.project(record(item))), nextCursor: page.hasNextPage === true && typeof page.endCursor === "string" ? page.endCursor : null };
    }
    if (cursor && !/^\d{1,8}$/.test(cursor)) throw new Error("tracker_oauth_scope_refused");
    const body = record(await this.request(`https://api.atlassian.com/ex/jira/${encodeURIComponent(resourceId)}/rest/api/3/project/search?maxResults=50&startAt=${cursor || "0"}`, { headers: { authorization: `Bearer ${bundle.accessToken}`, accept: "application/json" } }));
    if (!Array.isArray(body.values) || body.values.length > 50) throw new Error("tracker_oauth_provider_invalid");
    return { projects: body.values.map(item => this.project(record(item))), nextCursor: body.isLast === false && body.values.length > 0 ? String(Number(cursor || 0) + body.values.length) : null };
  }
  private project(item: Record<string, unknown>): TrackerOAuthProject { if (!identifier(item.id) || typeof item.key !== "string" || !/^[A-Z][A-Z0-9_]{0,49}$/.test(item.key) || !name(item.name)) throw new Error("tracker_oauth_provider_invalid"); return { id: item.id, key: item.key, name: item.name }; }
  async connect(scope: TrackerOAuthScope, envelope: TrackerOAuthEnvelope, resourceId: string, projectId: string) {
    const bundle = await this.open(scope, envelope), resource = this.resource(bundle, resourceId);
    if (!identifier(projectId) || bundle.expiresAt <= this.now()) throw new Error("tracker_oauth_reconnect_required");
    const raw = scope.provider === "linear" ? (await this.linear(bundle.accessToken, "query BuildITTeam($id:String!){ team(id:$id){ id key name } }", { id: projectId })).team : await this.request(`https://api.atlassian.com/ex/jira/${encodeURIComponent(resourceId)}/rest/api/3/project/${encodeURIComponent(projectId)}`, { headers: { authorization: `Bearer ${bundle.accessToken}`, accept: "application/json" } });
    const project = this.project(record(raw)); if (project.id !== projectId) throw new Error("tracker_oauth_scope_refused");
    const selected = { ...bundle, resources: [resource], resourceId, projectKeys: [project.key] };
    return { encryptedCredential: await this.seal(scope, selected), workspaceId: resource.workspaceId, resourceId, projectKeys: [project.key], scopes: bundle.scopes, tokenExpiresAt: bundle.expiresAt, maskedSuffix: bundle.accessToken.slice(-4) };
  }
  async refresh(scope: TrackerOAuthScope, envelope: TrackerOAuthEnvelope) {
    const bundle = await this.open(scope, envelope), token = await this.token(scope.provider, { grant_type: "refresh_token", refresh_token: bundle.refreshToken }, true);
    return { encryptedCredential: await this.seal(scope, { ...bundle, ...token }), tokenExpiresAt: token.expiresAt };
  }
  async revoke(scope: TrackerOAuthScope, envelope: TrackerOAuthEnvelope) {
    if (scope.provider === "jira") return { remoteRevoked: false, removalUrl: "https://id.atlassian.com/manage-profile/apps" };
    const bundle = await this.open(scope, envelope);
    const response = await this.http("https://api.linear.app/oauth/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: bundle.refreshToken, token_type_hint: "refresh_token" }).toString(), redirect: "manual", signal: AbortSignal.timeout(10_000) });
    return { remoteRevoked: response.status === 200, ...(response.status === 200 ? {} : { removalUrl: "https://linear.app/settings/api" }) };
  }
}
