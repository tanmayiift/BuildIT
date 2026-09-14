import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

// This collector writes files only. It contains no mail delivery client.
export async function storeEmailCapture(directory, message) {
  if (!message || typeof message !== "object" || !/^[A-Za-z\d:_-]{8,200}$/.test(message.idempotencyKey ?? "") || typeof message.to !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(message.to) || typeof message.subject !== "string" || !message.subject.startsWith("[BuildIT local capture]") || typeof message.html !== "string" || typeof message.text !== "string") throw new Error("capture_message_invalid");
  const payload = JSON.stringify({ to: message.to, subject: message.subject, text: message.text, html: message.html, idempotencyKey: message.idempotencyKey });
  if (Buffer.byteLength(payload) > 512_000) throw new Error("capture_message_too_large");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const captureId = createHash("sha256").update(message.idempotencyKey).digest("hex");
  const target = join(directory, `${captureId}.json`), temporary = join(directory, `.${randomUUID()}.tmp`);
  await writeFile(temporary, payload, { flag: "wx", mode: 0o600 });
  try {
    try { await link(temporary, target); }
    catch (error) { if (error.code !== "EEXIST") throw error; if (await readFile(target, "utf8") !== payload) throw new Error("capture_idempotency_conflict"); }
  } finally { await unlink(temporary); }
  return { kind: "captured", captureId, idempotencyKey: message.idempotencyKey };
}

export function emailCaptureHandler(directory) {
  return async (request, response) => {
    const respond = (status, body) => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(body)); };
    // Reject browser-origin requests: this endpoint is only for the local backend worker.
    if (request.headers.origin || request.headers["sec-fetch-site"] || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress)) return respond(403, { error: "capture_forbidden" });
    if (request.method !== "POST" || request.url !== "/capture" || request.headers["content-type"] !== "application/json") return respond(404, { error: "capture_not_found" });
    try {
      let size = 0; const chunks = [];
      for await (const chunk of request) { size += chunk.length; if (size > 512_000) return respond(413, { error: "capture_message_too_large" }); chunks.push(chunk); }
      const receipt = await storeEmailCapture(directory, JSON.parse(Buffer.concat(chunks).toString("utf8")));
      respond(200, receipt);
    } catch { respond(409, { error: "capture_failed" }); }
  };
}
