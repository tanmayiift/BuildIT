import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

// A commit's tarball, as GitHub serves it: `git archive` output with one top-level directory
// ("owner-repo-<sha>/"), a pax global header whose comment is the commit id, and pax extended
// headers for paths longer than ustar's 100 bytes. Only regular files are returned; a symlink, a
// directory or anything else is left for the blob API.
//
// Nothing read from here is trusted on its own: the caller keeps a file only when its git blob id
// equals the tree's, so the archive can save requests but never change what a review reads.
export type ArchiveRead = { commit?: string; files: Map<string, Buffer> };

export function gitBlobSha(bytes: Buffer) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function text(block: Buffer, start: number, length: number) {
  const field = block.subarray(start, start + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString("utf8");
}

function octal(block: Buffer, start: number, length: number) {
  // A base-256 size (high bit set) is how tar writes files past 8 GB; no file here is that size.
  if (block[start]! & 0x80) throw new Error("archive_size_unsupported");
  const value = text(block, start, length).trim();
  if (!/^[0-7]*$/.test(value)) throw new Error("archive_header_malformed");
  return value ? parseInt(value, 8) : 0;
}

// "<length> <key>=<value>\n", repeated; the length counts the whole record.
function paxRecords(body: Buffer) {
  const records = new Map<string, string>();
  let offset = 0;
  while (offset < body.length) {
    const space = body.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number(body.subarray(offset, space).toString("ascii"));
    if (!Number.isInteger(length) || length <= space - offset || offset + length > body.length) throw new Error("archive_header_malformed");
    const record = body.subarray(space + 1, offset + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals > 0) records.set(record.slice(0, equals), record.slice(equals + 1));
    offset += length;
  }
  return records;
}

export function readTarball(gzipped: Buffer, input: { maxBytes: number; wanted: (path: string) => boolean }): ArchiveRead {
  const tar = gunzipSync(gzipped, { maxOutputLength: input.maxBytes });
  const files = new Map<string, Buffer>();
  let commit: string | undefined;
  let longPath: string | undefined;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    const bodyStart = offset + 512;
    if (bodyStart + size > tar.length) throw new Error("archive_truncated");
    const body = tar.subarray(bodyStart, bodyStart + size);
    offset = bodyStart + Math.ceil(size / 512) * 512;

    if (type === "g") { commit = paxRecords(body).get("comment") ?? commit; continue; }
    if (type === "x") { longPath = paxRecords(body).get("path"); continue; }
    if (type === "L") { longPath = text(body, 0, body.length); continue; }
    const prefix = text(header, 345, 155), name = text(header, 0, 100);
    const path = longPath ?? (prefix ? `${prefix}/${name}` : name);
    longPath = undefined;
    if (type !== "0") continue;
    // Drop the "owner-repo-<sha>/" directory every entry sits under.
    const slash = path.indexOf("/");
    if (slash === -1) continue;
    const relative = path.slice(slash + 1);
    if (input.wanted(relative)) files.set(relative, body);
  }
  return { ...(commit ? { commit } : {}), files };
}
