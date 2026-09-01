"use client";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useAuthToken } from "@convex-dev/auth/react";
import { makeFunctionReference } from "convex/server";
import { type FormEvent, useEffect, useState } from "react";
import { credentialErrorCode, credentialErrorMessage, credentialNeedsIdentityRecovery, credentialReauthenticationHref, credentialSignInHref, needsFreshCredentialAuthentication, type CredentialErrorCode } from "./model-key-state";
type Provider = "anthropic" | "openai" | "gemini";
type Connection = {
  organization: null | { id: string; name: string; role: string };
  credentialReauthenticationExpiresAt?: number;
  repositories: Array<{ id: string; owner: string; name: string }>;
};
type SavedCredential = {
  id: string;
  provider: Provider;
  repositoryId?: string;
  maskedSuffix: string;
  status: string;
  lastValidatedAt: number;
  lastUsedAt?: number;
};
const connectionQuery = makeFunctionReference<
  "query",
  Record<string, never>,
  Connection
>("repositoryConnections:current");
const credentialsQuery = makeFunctionReference<
  "query",
  { organizationId: string },
  SavedCredential[]
>("integrations:listProviderCredentials");
const revokeMutation = makeFunctionReference<
  "mutation",
  { organizationId: string; credentialId: string; requestId: string },
  { id: string; status: "revoked" }
>("integrations:revokeProviderCredential");
const names: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Google Gemini",
};
const credentialContractVersion = "2026-08-30.1";
export function ModelKeyForm() {
  const [hydrated, setHydrated] = useState(false),
    { isAuthenticated, isLoading } = useConvexAuth(),
    token = useAuthToken(),
    connection = useQuery(
      connectionQuery,
      hydrated && isAuthenticated ? {} : "skip",
    ),
    organization = connection?.organization,
    canManage =
      organization?.role === "owner" || organization?.role === "admin",
    credentials = useQuery(
      credentialsQuery,
      canManage && organization ? { organizationId: organization.id } : "skip",
    ),
    revokeCredential = useMutation(revokeMutation),
    [provider, setProvider] = useState<Provider>("anthropic"),
    [repositoryId, setRepositoryId] = useState(""),
    [replacesCredentialId, setReplacesCredentialId] = useState(""),
    [confirmRevokeId, setConfirmRevokeId] = useState(""),
    [apiKey, setApiKey] = useState(""),
    [now, setNow] = useState(0),
    [working, setWorking] = useState(false),
    [result, setResult] = useState<{
      kind: "success" | "error";
      text: string;
      code?: CredentialErrorCode;
    } | null>(null),
    brokerUrl = process.env.NEXT_PUBLIC_BROKER_URL;
  useEffect(() => {
    setHydrated(true);
    setNow(Date.now());
    const params = new URLSearchParams(window.location.search), requestedProvider = params.get("provider"), requestedRepository = params.get("repository");
    if (requestedProvider === "anthropic" || requestedProvider === "openai" || requestedProvider === "gemini") setProvider(requestedProvider);
    if (requestedRepository) setRepositoryId(requestedRepository);
  }, []);
  useEffect(() => {
    const expiresAt = connection?.credentialReauthenticationExpiresAt;
    if (!expiresAt || expiresAt <= Date.now()) return;
    const timeout = window.setTimeout(() => setNow(Date.now()), Math.min(expiresAt - Date.now() + 25, 2_147_483_647));
    return () => window.clearTimeout(timeout);
  }, [connection?.credentialReauthenticationExpiresAt]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !organization || !brokerUrl || !apiKey) return;
    const key = apiKey,
      repo = connection?.repositories.find((item) => item.id === repositoryId),
      scope = repo
        ? `${organization.name} → ${repo.owner}/${repo.name}`
        : `${organization.name} → all connected repositories`,
      rotating = Boolean(replacesCredentialId);
    setApiKey("");
    setWorking(true);
    setResult(null);
    try {
      const response = await fetch(
        `${brokerUrl.replace(/\/$/, "")}/api/credentials`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            organizationId: organization.id,
            ...(repositoryId ? { repositoryId } : {}),
            provider,
            apiKey: key,
            ...(replacesCredentialId ? { replacesCredentialId } : {}),
          }),
        },
      );
      const body = (await response.json()) as {
        error?: string;
        credential?: { maskedSuffix: string };
      };
      if (response.headers.get("x-buildit-credential-contract") !== credentialContractVersion) throw new Error("service_update_required");
      if (!response.ok) throw new Error(body.error ?? "credential_save_failed");
      setReplacesCredentialId("");
      setResult({
        kind: "success",
        text: `${names[provider]} key ending in ${body.credential?.maskedSuffix ?? "••••"} was validated, encrypted, and ${rotating ? "rotated" : "saved"} for ${scope}.`,
      });
    } catch (error) {
      const code = credentialErrorCode(error);
      setResult({
        kind: "error",
        text: credentialErrorMessage(code),
        code,
      });
    } finally {
      setWorking(false);
    }
  }
  async function revoke(credential: SavedCredential) {
    if (!organization || credential.status === "revoked") return;
    setWorking(true);
    setResult(null);
    try {
      await revokeCredential({
        organizationId: organization.id,
        credentialId: credential.id,
        requestId: `credential-revoke-${crypto.randomUUID()}`,
      });
      setConfirmRevokeId("");
      setResult({
        kind: "success",
        text: `${names[credential.provider]} key ending in ${credential.maskedSuffix} was revoked. BuildIT will not use it again.`,
      });
    } catch (error) {
      const code = credentialErrorCode(error);
      setResult({
        kind: "error",
        text: credentialErrorMessage(code),
        code,
      });
    } finally {
      setWorking(false);
    }
  }
  function beginRotation(credential: SavedCredential) {
    setProvider(credential.provider);
    setRepositoryId(credential.repositoryId ?? "");
    setReplacesCredentialId(credential.id);
    setResult(null);
    document.getElementById("provider-api-key")?.focus();
  }
  if (!hydrated || isLoading || (isAuthenticated && !connection))
    return (
      <section className="setup-card" aria-live="polite">
        <h2>Secure model connection</h2>
        <p>Checking your account and organization…</p>
      </section>
    );
  if (!isAuthenticated)
    return (
      <section className="setup-card">
        <Heading />
        <div className="credential-state">
          <strong>Sign in before adding a key</strong>
          <p>
            This binds the encrypted credential to one verified organization.
            Signing in alone does not grant repository access.
          </p>
          <a className="button" href={credentialSignInHref(provider, repositoryId)}>
            Sign in with GitHub
          </a>
        </div>
        <KeyTrust />
        <Boundary />
      </section>
    );
  if (!organization)
    return (
      <section className="setup-card">
        <h2>Choose an organization first</h2>
        <p>
          Connect or select an organization so BuildIT keeps this key in the
          correct security boundary.
        </p>
        <a className="button" href="/setup/install">
          Connect GitHub
        </a>
        <Boundary />
      </section>
    );
  if (!canManage)
    return (
      <section className="setup-card">
        <h2>An Admin or Owner manages model keys</h2>
        <p>
          Your {organization.role} access cannot add or replace credentials.
        </p>
        <Boundary />
      </section>
    );
  const reauthenticationHref = credentialReauthenticationHref(provider, repositoryId);
  if (needsFreshCredentialAuthentication(connection?.credentialReauthenticationExpiresAt, now))
    return (
      <section className="setup-card">
        <Heading />
        <div className="credential-state">
          <strong>Verify with GitHub before entering a key</strong>
          <p>Your repository access is unchanged. BuildIT requires a fresh GitHub login before an Owner or Admin can add an encrypted model-provider key. This prevents someone using an unattended session from replacing your organization’s key.</p>
          <a className="button" href={reauthenticationHref}>Verify with GitHub</a>
        </div>
        <KeyTrust />
        <Boundary />
      </section>
    );
  return (
    <section className="setup-card">
      <Heading />
      {replacesCredentialId ? (
        <div className="rotation-note" role="status">
          <span>
            <strong>Rotating {names[provider]} safely</strong>
            <small>
              The current key stays active unless the replacement validates and
              encrypts successfully.
            </small>
          </span>
          <button
            className="button tertiary compact"
            type="button"
            onClick={() => setReplacesCredentialId("")}
          >
            Cancel
          </button>
        </div>
      ) : null}
      <form className="credential-form" onSubmit={save}>
        <KeyTrust />
        <div className="credential-grid">
          <label className="field">
            <span>Provider</span>
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value as Provider)}
            >
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="gemini">Google Gemini</option>
            </select>
          </label>
          <label className="field">
            <span>Repository scope</span>
            <select
              value={repositoryId}
              onChange={(event) => setRepositoryId(event.target.value)}
            >
              <option value="">All repositories in {organization.name}</option>
              {connection.repositories.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.owner}/{repo.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="scope-trail" aria-label="Credential scope">
          <span>This key can be used by</span>
          <strong>
            {organization.name} · {repositoryId
              ? connection.repositories.find((item) => item.id === repositoryId)
                  ?.name
              : "all connected repositories"}
          </strong>
          <small>Only after a person approves a review</small>
          <span className="scope-check" aria-hidden="true">✓</span>
        </div>
        <label className="field">
          <span>{names[provider]} API key</span>
          <input
            id="provider-api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Paste key to validate and encrypt"
            required
            minLength={16}
            disabled={working}
          />
        </label>
        <button
          className="button"
          type="submit"
          disabled={working || !apiKey || !brokerUrl}
        >
          {working
            ? "Validating and encrypting…"
            : replacesCredentialId
              ? "Validate and rotate key"
              : "Validate and save key"}
        </button>
        {!brokerUrl ? (
          <p className="form-result error" role="alert">
            Secure key storage is not configured for this environment.
          </p>
        ) : null}
        {result ? (
          <div className={`form-result ${result.kind}`} role={result.kind === "error" ? "alert" : "status"}>
            <span>{result.text}</span>
            {credentialNeedsIdentityRecovery(result.code) ? <a className="button secondary compact" href={reauthenticationHref}>Verify with GitHub</a> : null}
          </div>
        ) : null}
      </form>
      {credentials?.length ? (
        <section className="saved-credentials" aria-labelledby="saved-credentials-title">
          <div className="saved-credentials-heading">
            <div>
              <p className="eyebrow">Ready for reviews</p>
              <h3 id="saved-credentials-title">Saved model keys</h3>
            </div>
            <span className="status success">{credentials.filter(item => item.status !== "revoked").length} active</span>
          </div>
          {credentials.map((credential) => (
            <article className="credential-row" key={credential.id}>
              <span className="provider-mark">
                {names[credential.provider].slice(0, 2).toUpperCase()}
              </span>
              <span className="credential-identity">
                <strong>{names[credential.provider]}</strong>
                <code aria-label={`Key ending in ${credential.maskedSuffix}`}>•••• {credential.maskedSuffix}</code>
              </span>
              <dl className="credential-metadata">
                <div><dt>Scope</dt><dd>{credential.repositoryId ? (() => { const repository = connection?.repositories.find(item => item.id === credential.repositoryId); return repository ? `${repository.owner}/${repository.name}` : "Removed repository"; })() : "All connected repositories"}</dd></div>
                <div><dt>Status</dt><dd>{credential.status === "revoked" ? "Revoked" : "Validated"}</dd></div>
                <div><dt>Activity</dt><dd>{credential.status === "revoked" ? "No longer usable" : `${new Date(credential.lastValidatedAt).toLocaleDateString()} · ${credential.lastUsedAt ? `used ${new Date(credential.lastUsedAt).toLocaleDateString()}` : "not used yet"}`}</dd></div>
              </dl>
              {confirmRevokeId === credential.id ? <span className="credential-confirm"><small>Stop BuildIT from using this key?</small><button className="button tertiary compact" type="button" disabled={working} onClick={() => setConfirmRevokeId("")}>Cancel</button><button className="button destructive compact" type="button" disabled={working} onClick={() => void revoke(credential)}>Confirm revoke</button></span> : <span className="credential-actions"><button className="button secondary compact" type="button" disabled={working || credential.status === "revoked"} onClick={() => beginRotation(credential)}>Replace</button><button className="button destructive compact" type="button" disabled={working || credential.status === "revoked"} onClick={() => setConfirmRevokeId(credential.id)}>{credential.status === "revoked" ? "Revoked" : "Revoke"}</button></span>}
            </article>
          ))}
        </section>
      ) : null}
      <Boundary />
    </section>
  );
}
function Heading() {
  return (
    <div className="optional-heading">
      <div>
        <h2>Bring your own model key</h2>
        <p>The key is requested only when you choose AI analysis or Autofix.</p>
      </div>
      <span className="status neutral">Optional now</span>
    </div>
  );
}
function Boundary() {
  return (
    <div className="boundary-note">
      <strong>Security boundary</strong>
      <br />
      The raw key goes directly from this browser to BuildIT’s separate
      credential broker. It is validated, encrypted with AWS KMS in Ireland, and
      never returned to the browser or stored in Convex as plaintext.
    </div>
  );
}

function KeyTrust() {
  return <details className="key-trust"><summary><span><strong>GitHub login and model key stay separate</strong><small>See exactly what BuildIT can read, use, and change</small></span></summary><p>GitHub proves who you are. This key only pays the selected AI provider for reviews you approve.</p><dl className="trust-answers"><div><dt>Sent to the model</dt><dd>Only the exact PR context and bounded evidence shown before consent—not another repository.</dd></div><div><dt>GitHub changes</dt><dd>None from this key. A stacked PR needs separate consent and a short-lived GitHub App token.</dd></div><div><dt>Evidence required</dt><dd>Every finding requires source or test evidence, an independent critic, and deterministic checks. Missing proof is inconclusive.</dd></div><div><dt>Merge authority</dt><dd>Only a human can merge. BuildIT has no merge, workflow, settings, or unselected-repository permission.</dd></div><div><dt>Storage</dt><dd>The broker validates and encrypts the key with AWS KMS in Ireland. Plaintext is never stored in Convex.</dd></div><div><dt>Control</dt><dd>An Owner or Admin can replace or revoke it here. BuildIT cannot recover the original key.</dd></div></dl></details>;
}
