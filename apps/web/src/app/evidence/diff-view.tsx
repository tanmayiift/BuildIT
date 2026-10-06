// A unified diff as a fix changes it. Added and removed lines carry a + or − glyph and a
// screen-reader word as well as a tint, so the change never depends on colour alone.
// It scrolls sideways on a narrow screen, so it takes keyboard focus and names itself (WCAG 2.1.1).
export function DiffView({ lines, label }: { lines: readonly string[]; label: string }) {
  return (
    <pre className="diff-view" tabIndex={0} aria-label={label}><code>{lines.map((line, index) => {
      const kind = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "context";
      return (
        <span key={index} className={`diff-line ${kind}`}>
          <span className="diff-mark" aria-hidden="true">{kind === "add" ? "+" : kind === "del" ? "−" : " "}</span>
          <span>{line.slice(1) || " "}</span>
          {kind === "context" ? null : <span className="sr-only">{kind === "add" ? " (added)" : " (removed)"}</span>}
          {"\n"}
        </span>
      );
    })}</code></pre>
  );
}
