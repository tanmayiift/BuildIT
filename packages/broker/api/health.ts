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
  return Response.json(
    { service: "buildit-content-broker", status: "available", commit },
    { headers: { "cache-control": "no-store" } },
  );
}

export const GET = route;
