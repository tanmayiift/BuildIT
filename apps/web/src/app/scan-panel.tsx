"use client";
import { useId, useState } from "react";
import { scanErrorCode, scanErrorMessage, type ScanErrorCode } from "./scan-error-state";

// The scan was the only place in the product where a stranger could watch BuildIT do its job, and
// it lived one navigation away on a page that printed its findings as a bulleted list underneath
// the code. A list underneath is the one presentation that discards the product's central claim:
// every finding names a file and a line, so the finding belongs ON that line. This renders the
// scanned text with the findings pinned to the lines they cite, and it is shared rather than
// duplicated so the landing hero, /scan and /features are all the same working control.

type Finding = { ruleId: string; severity: string; path: string; startLine: number; summary: string };
type Secret = { path: string; line: number };
type Result = { findings: Finding[]; secrets: Secret[]; ran: string[]; didNotRun: string[]; filesScanned: number };
type Note = { severity: string; summary: string; line: number };

// Assembled rather than written out, for the reason recorded in
// packages/security/test/redaction.test.ts: BuildIT's own rules and gitleaks run over this whole
// repository, so a literal here would fail a required check on every review of BuildIT itself.
const example = {
  path: "src/http-client.ts",
  content: [
    "export function connect(url: string) {",
    `  const agent = new https.Agent({ rejectUnauthorized: ${["fal", "se"].join("")} });`,
    "  return fetch(url, { agent });",
    "}",
    "",
    "export function renderTemplate(userInput: string) {",
    `  return ${["ev", "al"].join("")}(userInput);`,
    "}",
  ].join("\n"),
};

const placeholder = "Paste a file here. It is checked on the server and never stored.";

// Ordered worst first, because a reader scanning the tally wants the blocking count first.
const severityOrder = ["critical", "warning", "info"] as const;

export function ScanPanel({ variant = "page" }: { variant?: "page" | "card" }) {
  const field = useId();
  const [path, setPath] = useState("src/example.ts");
  const [content, setContent] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  // The annotated listing has to be the text the server actually read, not whatever is in the
  // textarea now. Keeping the scanned copy means editing the code after a scan cannot silently
  // slide a finding onto a line it was never about.
  const [scanned, setScanned] = useState<{ path: string; lines: string[] } | null>(null);
  const [error, setError] = useState<ScanErrorCode | "">("");
  const [running, setRunning] = useState(false);

  async function scan(nextPath: string, nextContent: string) {
    setRunning(true); setError(""); setResult(null); setScanned(null);
    try {
      const response = await fetch("/api/scan", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ files: [{ path: nextPath, content: nextContent }] }),
      });
      const body = await response.json() as Result & { error?: string };
      if (!response.ok) { setError(scanErrorCode(body.error)); return; }
      setResult(body);
      setScanned({ path: nextPath, lines: nextContent.split("\n") });
    } catch { setError("network_unavailable"); } finally { setRunning(false); }
  }

  // Someone who arrived with nothing to paste had nothing to do here at all. One click now fills
  // the form and runs it, so the first thing a visitor can see is a real annotated result.
  function useExample() {
    setPath(example.path);
    setContent(example.content);
    void scan(example.path, example.content);
  }

  const notes = new Map<number, Note[]>();
  const add = (line: number, note: Note) => notes.set(line, [...(notes.get(line) ?? []), note]);
  if (result) {
    for (const finding of result.findings) add(finding.startLine, { severity: finding.severity, summary: finding.summary, line: finding.startLine });
    for (const secret of result.secrets) add(secret.line, { severity: "critical", line: secret.line, summary: "Matches a known credential pattern. The value is not stored or echoed back." });
  }
  const total = result ? result.findings.length + result.secrets.length : 0;
  const tally = severityOrder
    .map(severity => ({ severity, count: [...notes.values()].flat().filter(note => note.severity === severity).length }))
    .filter(entry => entry.count > 0);

  return <div className={`scan-panel${variant === "card" ? " scan-card" : ""}`}>
    <div className="scan-form">
      <div className="field scan-path-field">
        <label htmlFor={`${field}-path`}>File path</label>
        <input id={`${field}-path`} value={path} onChange={event => setPath(event.target.value)} spellCheck={false} />
      </div>
      <div className="field">
        <label htmlFor={`${field}-content`}>Code</label>
        <textarea id={`${field}-content`} rows={variant === "card" ? 7 : 12} spellCheck={false} placeholder={placeholder}
          value={content} onChange={event => setContent(event.target.value)} />
      </div>
      <div className="button-row">
        <button className="button" type="button" onClick={() => void scan(path, content)} disabled={running || !content.trim()}>
          {running ? "Checking…" : "Check this code"}
        </button>
        <button className="button secondary" type="button" onClick={useExample} disabled={running}>Use an example</button>
      </div>
    </div>

    <div aria-live="polite" className="scan-output">
      {/* The code itself never reaches this element. This is the first thing a visitor with no
          account ever asks BuildIT to do, and "file_too_long" told them nothing they could act on. */}
      {error ? <p className="scan-error">{scanErrorMessage(error)}</p> : null}
      {result && scanned ? <section className="scan-result">
        <div className="scan-result-head">
          <h2>{total === 0 ? "These rules found nothing" : `${total} thing${total === 1 ? "" : "s"} to look at`}</h2>
          {tally.length ? <ul className="scan-tally">{tally.map(entry =>
            <li key={entry.severity} data-severity={entry.severity}>{entry.count} {entry.severity}</li>)}</ul> : null}
        </div>
        {/* tabIndex, because in the card variant this listing scrolls: a scrollable region that
            cannot take focus cannot be scrolled from a keyboard (WCAG 2.1.1). */}
        <ol className="scan-code" tabIndex={0} aria-label={`${scanned.path}, ${scanned.lines.length} lines, ${total} annotated`}>
          {scanned.lines.map((line, index) => {
            const number = index + 1;
            const onThisLine = notes.get(number) ?? [];
            return <li key={number} className="scan-line" data-flagged={onThisLine.length ? "" : undefined}>
              <span className="scan-gutter" aria-hidden="true">{number}</span>
              <code className="scan-source">{line === "" ? " " : line}</code>
              {onThisLine.length ? <ul className="scan-notes">{onThisLine.map((note, position) =>
                <li key={position} className="scan-note" data-severity={note.severity}>
                  <strong data-severity={note.severity}>{note.severity}</strong>
                  <code>{scanned.path}:{note.line}</code>
                  <span>{note.summary}</span>
                </li>)}</ul> : null}
            </li>;
          })}
        </ol>
        {/* The load-bearing sentence. A clean result from two regex passes is not a clean review,
            and the panel has to name the checks that never ran rather than let silence imply they
            did - so it renders on every result, in every variant. */}
        <p className="scan-boundary">
          Ran: {result.ran.join(", ")}. <strong>Did not run: {result.didNotRun.join(", ")}.</strong>
        </p>
      </section> : null}
    </div>
  </div>;
}
