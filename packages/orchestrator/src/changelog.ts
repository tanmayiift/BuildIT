// A changelog entry BuildIT writes carries the same constraint as everything else it writes: it may
// only say what it can show. Built from the merged pull request and that review's own findings, so
// it cannot describe a fix that did not happen or a problem nobody found.
//
// The entry lands in a pull request a person merges. BuildIT does not push to the default branch
// and does not merge its own changelog - the same boundary as autofix, for the same reason.

const heading = "# Changelog";

// A pull request title is text somebody else wrote, and it is about to be pasted into a Markdown
// file. Flattened to one line with no heading markers, so a title cannot invent a release section.
function flatten(text: string, limit: number) {
  return text.replace(/\s+/g, " ").replace(/^[#\-*>]+\s*/, "").trim().slice(0, limit);
}

export function changelogEntry(input: { prNumber: number; title: string; mergedAt: number; fixedFindings: ReadonlyArray<string> }) {
  const date = new Date(input.mergedAt).toISOString().slice(0, 10);
  const fixes = input.fixedFindings.length
    ? ` — BuildIT fixed: ${input.fixedFindings.map(item => flatten(item, 120)).join("; ")}`
    : "";
  return `- ${date} #${input.prNumber} ${flatten(input.title, 160)}${fixes}`;
}

// Returns the new file, or undefined when this pull request is already listed - a merge webhook can
// arrive more than once, and a changelog that gains a duplicate line every redelivery is worse than
// no changelog.
export function insertChangelogEntry(existing: string | undefined, entry: string) {
  const marker = entry.match(/#\d+/)?.[0];
  if (existing && marker && existing.includes(`${marker} `)) return undefined;
  if (!existing?.trim()) return `${heading}\n\n${entry}\n`;

  const lines = existing.split("\n");
  const headingAt = lines.findIndex(line => line.trim().toLowerCase().startsWith("# changelog"));
  if (headingAt === -1) return `${heading}\n\n${entry}\n\n${existing.trimStart()}`;

  // Above the first existing entry, below anything a person wrote under the heading.
  const firstEntry = lines.findIndex((line, index) => index > headingAt && line.trimStart().startsWith("- "));
  const at = firstEntry === -1 ? lines.length : firstEntry;
  return [...lines.slice(0, at), entry, ...lines.slice(at)].join("\n");
}
