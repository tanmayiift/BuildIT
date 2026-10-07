import { gunzipSync, gzipSync } from "node:zlib";

// A review's context chunks - the repository source for head and base, and the pull request - were
// uploaded as plain JSON, and that upload was most of BuildIT's Convex data egress:
// reviewContextWorker.gather sent 294 MB of the 416 MB used by 7 Oct 2026, against a Free plan
// allowance of 1 GB a month. Source text is the most compressible thing BuildIT stores; gzip takes
// it to a fraction of its size.
//
// The format is in the bytes: a gzip stream begins 0x1f 0x8b and no JSON document can, so every
// reader takes both, and chunks stored before this change stay readable. The checksum and size a
// reader verifies are of the stored bytes, so integrity is checked before anything is inflated.
const decodedCeiling = 16_000_000;

export function encodeContextArtifact(value: unknown) {
  return gzipSync(Buffer.from(JSON.stringify(value), "utf8"));
}

export function decodeContextArtifact(body: Uint8Array): unknown {
  const bytes = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  const text = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes, { maxOutputLength: decodedCeiling }) : bytes;
  return JSON.parse(text.toString("utf8"));
}
