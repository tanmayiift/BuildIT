"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useState } from "react";

type Organization = { id: string; name: string; slug: string; timezone: string; region: "eu-west-1"; role: string };
type ActiveOrganization = Pick<Organization, "id" | "name" | "slug" | "role"> | null;

const organizationsQuery = makeFunctionReference<"query", Record<string, never>, Organization[]>("organizations:listMine");
const activeQuery = makeFunctionReference<"query", Record<string, never>, ActiveOrganization>("organizations:active");
const selectActive = makeFunctionReference<"mutation", { organizationId: string }, string>("organizations:selectActive");

export function WorkspaceSwitcher() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const organizations = useQuery(organizationsQuery, isAuthenticated ? {} : "skip");
  const active = useQuery(activeQuery, isAuthenticated ? {} : "skip");
  const select = useMutation(selectActive);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (isLoading) return <div className="workspace-switcher" aria-live="polite"><span><strong>Checking workspace…</strong><small>Confirming your private session</small></span></div>;
  if (!isAuthenticated) return <div className="workspace-switcher preview-workspace"><span><strong>Sample workspace</strong><small>Interactive product tour</small></span></div>;
  if (!organizations) return <div className="workspace-switcher" aria-live="polite">Loading workspaces…</div>;
  if (!organizations.length) return <a className="workspace-switcher" href="/setup/install"><span><strong>No workspace yet</strong><small>Install the GitHub App to begin</small></span><span>→</span></a>;

  const selected = active?.id ?? organizations[0]!.id;
  return <div>
    <label className="workspace-select"><span className="sr-only">Active organization</span><select value={selected} disabled={pending} onChange={async (event) => {
      setPending(true); setError("");
      try {
        await select({ organizationId: event.target.value });
        window.location.assign("/");
      } catch {
        setError("That organization is no longer available. Reload and choose another.");
        setPending(false);
      }
    }}>{organizations.map((organization) => <option value={organization.id} key={organization.id}>{organization.name} · {organization.role}</option>)}</select><small>{pending ? "Switching securely…" : "Active organization"}</small></label>
    {error ? <p className="workspace-error" role="alert">{error}</p> : null}
  </div>;
}
