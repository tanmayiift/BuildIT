import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy } from "./security-policy";
import { known } from "./route-map";

// A terminal response is intentional: rewriting to Next's internal /_not-found route left
// unknown URLs hanging. Rendering notFound() behind the streamed root layout can also commit
// a 200 before the missing page is known. This fixed, source-free document needs no app render.
const notFoundDocument = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Page not found · BuildIT</title>
<style>body{margin:0;background:#f8fafc;color:#172033;font-family:Arial,Helvetica,sans-serif}main{max-width:680px;margin:12vh auto;padding:32px}h1{font-size:36px;line-height:1.2}p{max-width:560px;line-height:1.6;color:#46536a}nav{display:flex;flex-wrap:wrap;gap:16px;margin-top:28px}a{color:#163f77;text-underline-offset:4px}a:focus-visible{outline:3px solid #2872c9;outline-offset:5px}.brand{font-weight:700;font-size:20px;text-decoration:none}</style></head>
<body><main><a class="brand" href="/">BuildIT</a><h1>That page does not exist</h1><p>The address you followed is not a BuildIT page. It may have been renamed, or the link may be wrong.</p><nav aria-label="Page recovery"><a href="/">Go to the overview</a><a href="/reviews">Open the review queue</a></nav></main></body></html>`;

export default function proxy(request: NextRequest) {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const policy = contentSecurityPolicy(nonce);
  if (!known(request.nextUrl.pathname)) {
    return new NextResponse(request.method === "HEAD" ? null : notFoundDocument, {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": policy, "cache-control": "no-store", "x-robots-tag": "noindex" },
    });
  }

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
