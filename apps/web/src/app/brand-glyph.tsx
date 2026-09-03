// The mark was inline in AppShell, so the public header could only have it by copying the path
// data. One definition, two shells.
export function BrandGlyph() {
  return <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M24 18h-6v28h6" />
    <path d="M40 18h6v28h-6" />
    <path d="M25.5 32.5 30.5 38 38.5 26" strokeWidth={5} />
  </svg>;
}
