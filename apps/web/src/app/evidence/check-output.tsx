// The end of a failed check's output, where a test runner prints the failure. Redacted on the
// server; shown as text, never as markup.
export function CheckOutput({ name, lines, truncated }: { name: string; lines: readonly string[]; truncated: boolean }) {
  return (
    <figure className="check-output">
      <figcaption>{truncated ? `Last ${lines.length} lines of ${name}` : `Output of ${name}`}</figcaption>
      <pre tabIndex={0} aria-label={`Output of ${name}`}><code>{lines.join("\n")}</code></pre>
    </figure>
  );
}
