// NEXT_PUBLIC_CONVEX_URL is inlined by the build, just as in the browser provider.
// Return only the public hostname, never arbitrary environment values or credentials.
export function GET() {
  let convexHost: string | undefined;
  try {
    const url = new URL(process.env.NEXT_PUBLIC_CONVEX_URL ?? "");
    if (url.protocol === "https:" && !url.username && !url.password && !url.port &&
        url.pathname === "/" && !url.search && !url.hash &&
        /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.convex\.cloud$/.test(url.hostname)) convexHost = url.hostname;
  } catch {}
  return Response.json(
    { service: "buildit-web", status: convexHost ? "available" : "misconfigured", ...(convexHost ? { convexHost } : {}) },
    { status: convexHost ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
