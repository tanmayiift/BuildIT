// The lines a finding cites, as the commit under review holds them. The cited lines carry a marker
// and a screen-reader word as well as a tint, so the highlight never depends on colour alone.
export type ExcerptLine = { number: number; text: string; cited: boolean };

export function CodeExcerpt({ path, lines, clipped }: { path: string; lines: readonly ExcerptLine[]; clipped: boolean }) {
  const cited = lines.filter(line => line.cited);
  const range = cited.length ? `lines ${cited[0]!.number}${cited.length > 1 ? `–${cited.at(-1)!.number}` : ""}` : "";
  return (
    <figure className="code-excerpt">
      <figcaption><code>{path}</code>{range ? <span> · {range} cited</span> : null}{clipped ? <span> · first 40 lines shown</span> : null}</figcaption>
      <pre><code>{lines.map(line => (
        <span key={line.number} className={line.cited ? "code-line cited" : "code-line"}>
          <span className="code-line-number" aria-hidden="true">{line.number}</span>
          <span className="code-line-mark" aria-hidden="true">{line.cited ? "›" : " "}</span>
          <span>{line.text || " "}</span>
          {line.cited ? <span className="sr-only"> (cited line {line.number})</span> : null}
          {"\n"}
        </span>
      ))}</code></pre>
    </figure>
  );
}
