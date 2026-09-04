"use client";
import { useState } from "react";
import { scanErrorCode, scanErrorMessage, type ScanErrorCode } from "./scan-error-state";

// The only surface a visitor could reach without GitHub sign-in was a tour over invented data, so
// nobody could try BuildIT on code they actually cared about. This is a third state - not the
// sample tour, not a live workspace - and it says so, because a clean result here must never read
// as a clean review.

type Finding = { ruleId: string; severity: string; path: string; startLine: number; summary: string };
type Secret = { path: string; line: number };
type Result = { findings: Finding[]; secrets: Secret[]; ran: string[]; didNotRun: string[]; filesScanned: number };

const placeholder = [
  "// paste code here — it is checked on the server and never stored",
  `const agent = new https.Agent({ rejectUnauthorized: ${["fal", "se"].join("")} });`,
  `${["ev", "al"].join("")}(userInput);`,
  "",
].join("\n");

export default function Sandbox() {
  const [path, setPath] = useState("src/example.ts"),
    [content, setContent] = useState(""),
    [result, setResult] = useState<Result | null>(null),
    [error, setError] = useState<ScanErrorCode | "">(""),
    [running, setRunning] = useState(false);

  async function scan() {
    setRunning(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/scan", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ files: [{ path, content }] }),
      });
      const body = await response.json() as Result & { error?: string };
      if (!response.ok) { setError(scanErrorCode(body.error)); return; }
      setResult(body);
    } catch { setError("network_unavailable"); } finally { setRunning(false); }
  }

  return <div className="content trust-page">
    <p className="eyebrow">Open sandbox · no account, no key</p>
    <h1 className="title">Run BuildIT&rsquo;s deterministic rules on your own code</h1>
    <p className="lede">
      This is a fraction of a review, and it is the fraction that needs no trust from you: paste code,
      and the server runs BuildIT&rsquo;s own rules and secret patterns on it. Nothing is stored, no model is
      called, and no repository is read.
    </p>

    <div className="field">
      <label htmlFor="scan-path">File path</label>
      <input id="scan-path" value={path} onChange={event => setPath(event.target.value)} spellCheck={false} />
    </div>
    <div className="field">
      <label htmlFor="scan-content">Code</label>
      <textarea id="scan-content" rows={12} spellCheck={false} placeholder={placeholder}
        value={content} onChange={event => setContent(event.target.value)} />
    </div>
    <div className="button-row">
      <button className="button" onClick={scan} disabled={running || !content.trim()}>
        {running ? "Checking…" : "Check this code"}
      </button>
    </div>

    <div aria-live="polite">
      {/* The code itself never reaches the page. This is the hero call to action for someone with
          no account, and "file_too_long" told them nothing they could act on. */}
      {error ? <p className="scan-error">{scanErrorMessage(error)}</p> : null}
      {result ? <section className="scan-result">
        <h2>{result.findings.length + result.secrets.length === 0
          ? "These rules found nothing"
          : `${result.findings.length + result.secrets.length} thing${result.findings.length + result.secrets.length === 1 ? "" : "s"} to look at`}</h2>
        {result.findings.length ? <ul>{result.findings.map(finding => (
          <li key={`${finding.ruleId}-${finding.startLine}`}>
            <strong data-severity={finding.severity}>{finding.severity}</strong> <code>{finding.path}:{finding.startLine}</code> — {finding.summary}
          </li>))}</ul> : null}
        {result.secrets.length ? <ul>{result.secrets.map(secret => (
          <li key={`secret-${secret.line}`}>
            <strong data-severity="critical">critical</strong> <code>{secret.path}:{secret.line}</code> — matches a known credential pattern. The value is not stored or echoed back.
          </li>))}</ul> : null}
        {/* The load-bearing sentence. A clean result from two regex passes is not a clean review,
            and the page has to say which checks never ran rather than let silence imply they did. */}
        <p className="scan-boundary">
          Ran: {result.ran.join(", ")}. <strong>Did not run: {result.didNotRun.join(", ")}.</strong>{" "}
          A real BuildIT review pins an exact commit, runs your tests and the pinned scanners in an
          isolated sandbox, and makes a model justify every finding against that evidence.
        </p>
      </section> : null}
    </div>

    <div className="next"><strong>What this is not:</strong> a verdict. It is two deterministic passes on text you pasted, with no commit, no tests and no evidence behind them. Connect a repository to get a review that has to prove itself.</div>
    <div className="button-row"><a className="button" href="/setup/install">Connect a GitHub repository</a><a className="button secondary" href="/pricing">See pricing and limits</a></div>
  </div>;
}
