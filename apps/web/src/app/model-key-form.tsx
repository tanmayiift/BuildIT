"use client";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useAuthToken } from "@convex-dev/auth/react";
import { makeFunctionReference } from "convex/server";
import { type FormEvent, useEffect, useState } from "react";
import { credentialErrorCode, credentialErrorMessage, credentialNeedsIdentityRecovery, credentialReauthenticationHref, needsFreshCredentialAuthentication, type CredentialErrorCode } from "./model-key-state";
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
          <a className="button" href="/sign-in?returnTo=%2Fsetup%2Fmodel">
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
          <span>Organization</span>
          <strong>{organization.name}</strong>
          <b>→</b>
          <span>Repository</span>
          <strong>
            {repositoryId
              ? connection.repositories.find((item) => item.id === repositoryId)
                  ?.name
              : "All connected"}
          </strong>
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
        <div className="saved-credentials">
          <h3>Saved for this organization</h3>
          {credentials.map((credential) => (
            <div key={credential.id}>
              <span className="provider-mark">
                {names[credential.provider].slice(0, 2).toUpperCase()}
              </span>
              <span className="credential-identity">
                <strong>{names[credential.provider]}</strong>
                <code aria-label={`Key ending in ${credential.maskedSuffix}`}>•••• {credential.maskedSuffix}</code>
              </span>
              <span className="credential-scope">
                <span>{credential.repositoryId ? (() => { const repository = connection?.repositories.find(item => item.id === credential.repositoryId); return repository ? `${repository.owner}/${repository.name}` : "Removed repository"; })() : "All connected repositories"}</span>
                <small>{credential.status === "revoked" ? "Revoked" : `Validated ${new Date(credential.lastValidatedAt).toLocaleDateString()}`}</small>
              </span>
              {confirmRevokeId === credential.id ? <span className="credential-confirm"><small>Stop BuildIT from using this key?</small><button className="button tertiary compact" type="button" disabled={working} onClick={() => setConfirmRevokeId("")}>Cancel</button><button className="button destructive compact" type="button" disabled={working} onClick={() => void revoke(credential)}>Confirm revoke</button></span> : <span className="credential-actions"><button className="button secondary compact" type="button" disabled={working || credential.status === "revoked"} onClick={() => beginRotation(credential)}>Replace</button><button className="button destructive compact" type="button" disabled={working || credential.status === "revoked"} onClick={() => setConfirmRevokeId(credential.id)}>{credential.status === "revoked" ? "Revoked" : "Revoke"}</button></span>}
            </div>
          ))}
        </div>
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
  return <div className="key-trust"><strong>Two separate connections, two separate jobs</strong><p>GitHub proves who you are and gives BuildIT access only to repositories selected in GitHub. This model-provider key is not a GitHub key: it pays Google, OpenAI, or Anthropic for the AI calls you choose.</p><dl className="trust-answers"><div><dt>What reaches the AI provider?</dt><dd>The exact PR context and bounded evidence shown in the review consent screen—not another repository. Deterministic checks can run without this key.</dd></div><div><dt>What can this key change?</dt><dd>Nothing in GitHub. Autofix requires separate consent and a separate, short-lived GitHub App token for one stacked PR.</dd></div><div><dt>How does a review earn trust?</dt><dd>BuildIT pins both commits, runs named checks, requires source or test evidence for every finding, sends model claims through a critic, and returns inconclusive when proof is missing.</dd></div><div><dt>Who can merge?</dt><dd>Only a human. BuildIT has no merge permission and cannot edit workflows, repository settings, or unselected repositories.</dd></div><div><dt>How is the key protected?</dt><dd>The broker validates it, encrypts it with AWS KMS in Ireland, never shows it again, and never stores plaintext in Convex.</dd></div><div><dt>How do I stop access?</dt><dd>An organization Owner or Admin can revoke or replace the key here and remove repository access in GitHub. BuildIT cannot recover the original key.</dd></div></dl></div>;
}
