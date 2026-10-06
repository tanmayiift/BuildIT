// The homepage's one illustration, drawn rather than generated: many lines of a change, most of them
// passed over, and the single line a finding cites tied to the check that proved it. It sits on the
// emphasis panel, which is a deep ground in both colour schemes, and reads its colours from the
// panel's own tokens. Decorative: the panel's heading and paragraph say the same thing in words.
const bars = [
  { y: 22, width: 118, opacity: .18 }, { y: 38, width: 152, opacity: .26 }, { y: 54, width: 96, opacity: .2 },
  { y: 70, width: 136, opacity: .34 }, { y: 86, width: 164, opacity: .42 }, { y: 118, width: 128, opacity: .42 },
  { y: 134, width: 150, opacity: .32 }, { y: 150, width: 104, opacity: .24 }, { y: 166, width: 140, opacity: .18 },
] as const;

export function EvidenceSieve() {
  return (
    <svg className="evidence-sieve" viewBox="0 0 320 196" aria-hidden="true" focusable="false">
      {bars.map(bar => <rect key={bar.y} x={176 - bar.width} y={bar.y} width={bar.width} height="6" rx="3" fill="var(--panel-ink-2)" opacity={bar.opacity} />)}
      <rect x="24" y="100" width="152" height="8" rx="4" fill="var(--panel-accent)" />
      <path d="M182 104 H262" stroke="var(--panel-accent)" strokeWidth="1.5" strokeDasharray="2 5" strokeLinecap="round" />
      <circle cx="276" cy="104" r="16" fill="var(--panel-ok)" />
      <path d="M268 104.5 l5.5 5.5 l10 -11" fill="none" stroke="var(--panel)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
