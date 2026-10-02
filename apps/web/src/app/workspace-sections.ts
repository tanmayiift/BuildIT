// One list. The gate in workspace-route-boundary.tsx and the route table in [section]/page.tsx
// were maintained separately, and they drifted: /notifications was a valid section and in the
// settings nav, but missing from the gate, so it rendered the full workspace shell to an
// anonymous visitor instead of the sign-in gate. Nothing leaked, because NotificationPreferences
// self-gates - but that is the fallback, not the control.
export const workspaceSections = [
  // "overview" is first because it is the signed-in home, and it exists at all because the sidebar
  // used to point Overview at "/" - a public route. Clicking it while signed in dropped the reader
  // out of the workspace chrome entirely into the marketing shell, with no sidebar and no way back
  // except the brand link, and the product had no signed-in home at all: /reviews was the de facto
  // one. route-map.ts derives its segments from this list, so the Edge proxy learns the route here.
  "overview",
  "repositories", "history", "metrics", "usage", "integrations", "policies", "members", "notifications", "audit", "quality",
] as const;

export type WorkspaceSection = typeof workspaceSections[number];

export function isWorkspaceSection(value: string): value is WorkspaceSection {
  return (workspaceSections as readonly string[]).includes(value);
}
