// /api/scan refuses work with a snake_case code, and the page printed that code. The sandbox is
// the one call to action aimed at someone with no account and no reason to trust BuildIT yet, so
// "file_too_long" was the worst possible answer: it names an internal constant, says nothing about
// what to do, and reads like a crash.
//
// The limits below are the real ones from apps/web/src/app/api/scan/route.ts - maxBodyBytes,
// maxFiles and maxLinesPerFile. A sentence that quotes a limit the endpoint does not enforce is
// worse than no number at all, so scan-error-state.test.ts reads them back out of the route.
export const scanErrorCodes = [
  "request_too_large", "invalid_json", "files_required", "too_many_files",
  "invalid_file", "invalid_path", "file_too_long", "network_unavailable",
] as const;

export type ScanErrorCode = (typeof scanErrorCodes)[number] | "scan_failed";

// Narrowed at the boundary, the way credentialErrorCode narrows the broker's reply: whatever the
// endpoint returns, only these strings can ever reach the message table, so an unexpected server
// string cannot be rendered to a visitor.
export function scanErrorCode(value: unknown): ScanErrorCode {
  const code = value instanceof Error ? value.message : String(value);
  return (scanErrorCodes as readonly string[]).includes(code) ? code as ScanErrorCode : "scan_failed";
}

export function scanErrorMessage(code: ScanErrorCode) {
  if (code === "request_too_large") return "That is more code than the sandbox takes at once. It accepts about 128 KB of text, so paste a smaller section and check that.";
  if (code === "invalid_json") return "The code could not be sent in a form the scanner could read. Reload the page and paste it again.";
  if (code === "files_required") return "There was no code to check. Paste some code into the box, then run the check again.";
  if (code === "too_many_files") return "The sandbox checks at most 20 files at a time. Send fewer files and check the rest separately.";
  if (code === "invalid_file") return "The file path and the code both have to be plain text. Check the file path field, then run the check again.";
  if (code === "invalid_path") return "That file path cannot be used. Give a path inside a project, like src/example.ts, with no leading slash and no .. in it.";
  if (code === "file_too_long") return "That file is longer than the scanner accepts. It reads up to 4,000 lines at a time, so paste a smaller section.";
  if (code === "network_unavailable") return "The check could not reach BuildIT, so nothing was sent. Check your connection and try again.";
  return "The check did not run, and BuildIT did not say why. Nothing was stored. Try again in a moment.";
}
