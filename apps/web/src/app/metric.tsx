import type { ReactNode } from "react";

// One figure with its label and what it counts. /proof, /metrics and /history each had their own
// copy - two components and one hand-written set of divs - with the same markup and drifting props.
// .metric styles its children by element (span the label, strong the figure, small the detail), and
// the mobile.css :nth-child rules depend on every metric being a direct child of .metric-line.
export function Metric({ title, value, detail, note, hero = false }: { title: string; value: ReactNode; detail: ReactNode; note?: string | undefined; hero?: boolean }) {
  return <article className={`metric${hero ? " hero-metric" : ""}`}><span>{title}</span><strong>{value}</strong>{note ? <small>{note}</small> : null}<small>{detail}</small></article>;
}
