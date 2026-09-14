// This replaced a static public/health.json. A static file cannot tell a fresh deploy from a stale
// one: the post-deploy probe went green whether or not the build that answered it contained the
// change being shipped. `packages/runner` executes here rather than in Convex, so a runner fix can
// be deployed to Convex, pass every check, and still not be live - which is exactly what happened,
// twice, and looked identical to the fix not working.
//
// Reporting the build's commit lets the deploy assert the live broker is serving what it just
// built. The commit of a deployed build is not a secret; nothing else about the environment is
// exposed here.
function route() {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown";
  let convexHost: string | undefined;
  try {
    const url = new URL(process.env.CONVEX_URL ?? "");
    if (url.protocol === "https:" && !url.username && !url.password && !url.port &&
        url.pathname === "/" && !url.search && !url.hash &&
        /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.convex\.cloud$/.test(url.hostname)) convexHost = url.hostname;
  } catch {}
  return Response.json(
    { service: "buildit-content-broker", status: convexHost ? "available" : "misconfigured", commit, ...(convexHost ? { convexHost } : {}) },
    { status: convexHost ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}

export const GET = route;
