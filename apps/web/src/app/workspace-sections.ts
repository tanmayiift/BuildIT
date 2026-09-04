// One list. The gate in workspace-route-boundary.tsx and the route table in [section]/page.tsx
// were maintained separately, and they drifted: /notifications was a valid section and in the
// settings nav, but missing from the gate, so it rendered the full workspace shell to an
// anonymous visitor instead of the sign-in gate. Nothing leaked, because NotificationPreferences
// self-gates - but that is the fallback, not the control.
export const workspaceSections = [
  "repositories", "history", "metrics", "usage", "integrations", "policies", "members", "notifications", "audit",
] as const;

export type WorkspaceSection = typeof workspaceSections[number];

export function isWorkspaceSection(value: string): value is WorkspaceSection {
  return (workspaceSections as readonly string[]).includes(value);
}
