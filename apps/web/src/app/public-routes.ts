// One list of the routes a stranger can be on. AppShell reads it to choose the chrome and
// route-map.ts reads it to know the path exists, so a new public page cannot be added to one and
// forgotten in the other - the drift that workspace-sections.ts records having happened once
// already, when /notifications was a real section the gate did not know about.
export const publicRoutes = ["/", "/features", "/pricing", "/proof", "/sandbox", "/data-handling", "/sign-in"] as const;

export function isPublicRoute(pathname: string) {
  return (publicRoutes as readonly string[]).includes(pathname);
}
