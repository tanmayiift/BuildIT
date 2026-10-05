// Every customer-facing route that can be rendered without production OAuth.
// Workspace routes use the explicit sample tour so the test covers their full
// information layout without pretending sample data belongs to a signed-in user.
export const renderableRoutes = [
  "/",
  "/sign-in",
  "/account",
  "/data-handling", "/pricing", "/features", "/scan",
  // /proof and /quality had no browser coverage at all - absent from this sweep, the touch-target
  // list and the snapshot list. /proof is the strongest evidence page in the product and /quality is
  // the newest screen; both subscribe to Convex, so they render their own empty state without one.
  "/proof", "/quality?tour=1",
  "/history", "/reviews?tour=1",
  "/reviews/22?tour=1", "/reviews/418?tour=1", "/reviews/91?tour=1", "/reviews/420?tour=1",
  "/reviews/418?tour=1&state=cancelled",
  "/reviews/418?tour=1&state=running",
  "/reviews/418?tour=1&state=changes",
  "/reviews/418?tour=1&state=passed",
  "/reviews/418?tour=1&state=empty",
  "/reviews/418?tour=1&state=populated",
  "/repositories?tour=1",
  "/metrics?tour=1",
  "/usage?tour=1",
  "/integrations?tour=1",
  "/policies?tour=1",
  "/members?tour=1",
  "/notifications?tour=1",
  "/audit?tour=1",
  "/setup/install",
  "/setup/repository",
  "/setup/model",
  "/setup/health",
  "/not-a-real-route",
];
