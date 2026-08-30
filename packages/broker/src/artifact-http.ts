import type { ArtifactBroker } from "./artifacts.js";

const maxAuthorizationBytes = 8_200;

function headers(extra: Record<string, string> = {}) {
  return { "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra };
}

function json(status: number, error: string) {
  return Response.json({ error }, { status, headers: headers() });
}

function bearer(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || authorization.length > maxAuthorizationBytes) throw new Error("authentication_required");
  return authorization.slice(7);
}

function safeError(error: unknown) {
  const code = error instanceof Error ? error.message : "artifact_unavailable";
  if (code === "authentication_required") return { status: 401, code };
  if (code === "artifact_size_invalid" || code === "artifact_checksum_mismatch") return { status: 422, code };
  if (code === "artifact_grant_expired" || code === "artifact_grant_replayed") return { status: 410, code };
  if (code === "artifact_grant_invalid" || code === "artifact_grant_scope_invalid") return { status: 403, code: "artifact_grant_invalid" };
  return { status: 503, code: "artifact_unavailable" };
}

async function boundedBody(request: Request, maxBytes: number) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error("artifact_size_invalid");
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("artifact_size_invalid");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

export async function handleArtifactRequest(request: Request, broker: ArtifactBroker, maxArtifactBytes = 25_000_000) {
  try {
    const token = bearer(request);
    if (request.method === "PUT") {
      const checksum = request.headers.get("x-buildit-sha256") ?? "";
      if (!/^[0-9a-f]{64}$/i.test(checksum)) return json(400, "artifact_checksum_required");
      const body = await boundedBody(request, maxArtifactBytes);
      const saved = await broker.put(token, body, checksum);
      return Response.json(saved, { status: 201, headers: headers() });
    }
    if (request.method === "GET") {
      const artifact = await broker.get(token);
      return new Response(Buffer.from(artifact.body), { status: 200, headers: headers({
        "content-type": "application/octet-stream",
        "content-length": String(artifact.body.byteLength),
        "x-buildit-artifact-id": artifact.artifactId,
        "x-buildit-sha256": artifact.checksum,
      }) });
    }
    if (request.method === "DELETE") {
      const deleted = await broker.delete(token);
      return Response.json(deleted, { status: 200, headers: headers() });
    }
    return json(405, "method_not_allowed");
  } catch (error) {
    const safe = safeError(error);
    return json(safe.status, safe.code);
  }
}
