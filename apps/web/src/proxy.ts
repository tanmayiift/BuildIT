import { NextResponse, type NextRequest } from "next/server";
import { workspaceSections } from "./app/workspace-sections";
import { contentSecurityPolicy } from "./security-policy";

// Unknown routes answered 200 with a body that said "Page not found" - which reads as found to a
// crawler, a monitor, a link checker and anything else that goes by status rather than prose.
//
// The status has to be decided here. The root layout wraps children in <Suspense>, so Next
// flushes the shell and commits 200 before any page code runs; a notFound() after that cannot
// change a status already on the wire. The Edge proxy runs before the response exists.
const setupSteps = ["install", "repository", "model", "health"];

function known(pathname: string) {
  if (pathname === "/" || pathname === "") return true;
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 1) {
    return ["reviews", "account", "sign-in", "data-handling", "setup", "__nonce-probe"].includes(segments[0]!)
      || (workspaceSections as readonly string[]).includes(segments[0]!);
  }
  if (segments[0] === "setup") return segments.length === 2 && setupSteps.includes(segments[1]!);
  if (segments[0] === "reviews") return segments.length === 2;
  return true;
}

export default function proxy(request: NextRequest) {
  if (!known(request.nextUrl.pathname)) {
    return NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
  }

  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const policy = contentSecurityPolicy(nonce);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", policy);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|api/|favicon.ico).*)"],
};
