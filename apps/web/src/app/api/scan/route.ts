import { NextResponse } from "next/server";
import { scanBuildITRules } from "@buildit/scanners";
import { redact } from "@buildit/security";

// A visitor could not try BuildIT on their own code without signing in with GitHub, so the only
// pre-auth surface was a tour over invented data. This runs BuildIT's own deterministic rules on
// pasted code and nothing else: no model call, no repository access, no sandbox, no persistence.
//
// It is honest about being a fraction of a review. gitleaks and osv-scanner are binaries that only
// exist inside the credentialed sandbox, and the AI stages need a key, so this endpoint names what
// it did not run rather than letting a clean result imply a clean review.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// An unauthenticated, CPU-bound endpoint with no identity to rate-limit against: the only real
// defence is refusing work that is too large before doing any of it. scanBuildITRules is
// O(files x rules x lines), so every dimension is capped, not just the byte count.
const maxBodyBytes = 128_000;
const maxFiles = 20;
const maxLinesPerFile = 4_000;
// scanBuildITRules pins evidence to a 40-character commit. Pasted code has no commit, so this
// stands in for one internally and is never shown - calling it a pinned commit would be a lie.
const unpinned = "0".repeat(40);

type Submitted = { path?: unknown; content?: unknown };

function reject(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  // content-length is attacker-supplied, so it is checked first as a cheap refusal and then the
  // real byte length is checked again after reading - the pattern packages/broker/src/http.ts uses.
  if (Number(request.headers.get("content-length") ?? 0) > maxBodyBytes) return reject(413, "request_too_large");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBodyBytes) return reject(413, "request_too_large");

  let body: { files?: unknown };
  try { body = JSON.parse(raw) as { files?: unknown }; } catch { return reject(400, "invalid_json"); }
  if (!Array.isArray(body.files) || body.files.length === 0) return reject(400, "files_required");
  if (body.files.length > maxFiles) return reject(413, "too_many_files");

  const files: Array<{ path: string; content: string }> = [];
  for (const item of body.files as Submitted[]) {
    if (typeof item?.path !== "string" || typeof item?.content !== "string") return reject(400, "invalid_file");
    // scanBuildITRules throws scanner_unsafe_path on an absolute or traversing path; refuse here
    // so a visitor gets a reason rather than a 500.
    if (!item.path || item.path.startsWith("/") || item.path.includes("..")) return reject(400, "invalid_path");
    if (item.content.split("\n").length > maxLinesPerFile) return reject(413, "file_too_long");
    files.push({ path: item.path, content: item.content });
  }

  const run = scanBuildITRules(files, unpinned);
  // The same redaction pass every artifact goes through. Running it here is the point of the
  // endpoint being on a server: these patterns need node:crypto's module and cannot be bundled
  // into a browser, and without them a pasted key would return zero findings.
  const secrets = files.flatMap(file => file.content.split("\n").flatMap((line, index) =>
    redact(line) === line ? [] : [{ path: file.path, line: index + 1 }]));

  return NextResponse.json({
    findings: run.findings.map(finding => ({
      ruleId: finding.ruleId, severity: finding.severity, path: finding.path,
      startLine: finding.startLine, summary: finding.summary,
    })),
    secrets,
    // Named, not implied. A reader has to be able to see how far this is from a review.
    ran: ["buildit-rules", "secret-patterns"],
    didNotRun: ["gitleaks", "osv-scanner", "tests", "lint", "typecheck", "AI review"],
    filesScanned: files.length,
  });
}
