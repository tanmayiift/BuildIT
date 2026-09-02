// One definition of the policy, used by the middleware that serves it per request and by the test
// that checks it. React's development build needs eval() for callstack reconstruction and Fast
// Refresh; production keeps the stricter policy and this relaxation never reaches a deployed build.
const developmentOnlyScriptSources = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

// script-src allows inline script only by per-request nonce. The earlier attempt failed for a
// reason worth recording: Next stamps the nonce onto its own inline bootstrap scripts only when
// the route is rendered per request. Statically prerendered pages are generated at build time,
// when there is no request and so no nonce, so those pages had no nonce to stamp and the policy
// blocked its own hydration. The root layout is force-dynamic for that reason.
//
// 'strict-dynamic' lets a nonced script load the chunks it needs without listing each one, and
// makes browsers that honour it ignore host allowlists - so no 'self' or 'unsafe-inline' fallback
// is needed or wanted here.
export function contentSecurityPolicy(nonce: string) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    // 'strict-dynamic' lets a nonced script load the chunks it needs without listing each one.
    // 'unsafe-inline' stays as the fallback for browsers that do not honour a nonce; browsers that
    // do ignore it entirely, so it costs nothing where the nonce works.
    `script-src 'nonce-${nonce}' 'strict-dynamic'${developmentOnlyScriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self' https://*.convex.cloud wss://*.convex.cloud https://buildit-content-broker.vercel.app",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}
