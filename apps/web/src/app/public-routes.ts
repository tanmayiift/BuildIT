// One list of the routes a stranger can be on. AppShell reads it to choose the chrome and
// route-map.ts reads it to know the path exists, so a new public page cannot be added to one and
// forgotten in the other - the drift that workspace-sections.ts records having happened once
// already, when /notifications was a real section the gate did not know about.
export const publicRoutes = ["/", "/features", "/pricing", "/proof", "/sandbox", "/data-handling", "/sign-in"] as const;

// Onboarding is a stranger's route too, and it was in neither list. AppShell fell through to the
// workspace branch and wrapped a four-step wizard in the entire signed-in sidebar - Review queue,
// Repositories, Metrics, Audit log - with "Not signed in / Sign in with GitHub" underneath it and
// every one of those links bouncing straight back to a sign-in gate. It read as two products
// stacked on top of each other, which is exactly what a visitor said it looked like.
//
// A prefix rather than a member of publicRoutes because the step is dynamic and route-map.ts
// derives exact segments from that list. The wizard carries its own stepper, its own back link and
// its own progress chip, so marketing chrome is all it ever needed.
export const publicRoutePrefixes = ["/setup/"] as const;

export function isPublicRoute(pathname: string) {
  return (publicRoutes as readonly string[]).includes(pathname)
    || publicRoutePrefixes.some(prefix => pathname.startsWith(prefix));
}
