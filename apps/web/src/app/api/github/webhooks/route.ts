import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function convexWebhookUrl() {
  const explicit = process.env.CONVEX_SITE_URL;
  if (explicit) return new URL("/api/github/webhooks", explicit).toString();

  const cloudUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!cloudUrl) throw new Error("Convex webhook destination is not configured");
  const url = new URL(cloudUrl);
  url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site");
  url.pathname = "/api/github/webhooks";
  return url.toString();
}

export async function POST(request: Request) {
  let destination: string;
  try {
    destination = convexWebhookUrl();
  } catch {
    return NextResponse.json({ error: "webhook_unavailable" }, { status: 503 });
  }

  const body = await request.arrayBuffer();
  const headers = new Headers({ "content-type": request.headers.get("content-type") ?? "application/json" });
  for (const name of ["x-github-delivery", "x-github-event", "x-hub-signature-256"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const upstream = await fetch(destination, { method: "POST", headers, body, cache: "no-store", signal: AbortSignal.timeout(8_000) });
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "text/plain; charset=utf-8" },
    });
  } catch {
    return NextResponse.json({ error: "webhook_forward_failed" }, { status: 503 });
  }
}
