// What each judging stage actually needs to see. The critic and the arbitration call used to receive
// the whole review context - every selected file, every diff, all validation output, repository
// memory and the omission lists - about 95k tokens, to rule on findings that cite a handful of lines.
//
// They now receive the cited evidence: the files and diffs the findings point at, the requirements
// they claim to violate, and the pull request's title and a bounded description. Small cited files go
// whole; large ones become line-aligned windows around the cited lines, marked as excerpts. The keys
// stay where they were (`files[]`, `pull.changes[]`, `pull.requirements`), because injection scoping
// attributes a signal by its path in that shape - and it is computed once, over the full context, so
// nothing a narrowed view leaves out can hide a signal from it.

type ContextFile = { evidenceId?: unknown; path?: unknown; content?: unknown; startLine?: unknown; endLine?: unknown; [key: string]: unknown };
type CitingFinding = { path?: unknown; startLine?: unknown; endLine?: unknown; evidenceIds?: unknown; criterionId?: unknown };

export const citedEvidenceLimits = { maxBytes: 48_000, windowLines: 60, bodyChars: 4_000 } as const;

export function citedEvidenceView(untrusted: Record<string, unknown>, findings: readonly unknown[], limits: { maxBytes: number; windowLines: number; bodyChars: number } = citedEvidenceLimits): Record<string, unknown> {
  const ids = new Set<string>(), paths = new Set<string>(), criteria = new Set<string>(), ranges = new Map<string, Array<[number, number]>>();
  for (const value of findings) {
    if (!value || typeof value !== "object") continue;
    const finding = value as CitingFinding;
    if (Array.isArray(finding.evidenceIds)) for (const id of finding.evidenceIds) if (typeof id === "string") ids.add(id);
    if (typeof finding.criterionId === "string" && finding.criterionId) criteria.add(finding.criterionId);
    if (typeof finding.path !== "string") continue;
    paths.add(finding.path);
    const start = Number(finding.startLine), end = Number(finding.endLine);
    if (Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start) ranges.set(finding.path, [...(ranges.get(finding.path) ?? []), [start, end]]);
  }
  const allFiles = Array.isArray(untrusted.files) ? untrusted.files as ContextFile[] : [];
  const cited = allFiles.filter(file => (typeof file.evidenceId === "string" && ids.has(file.evidenceId)) || (typeof file.path === "string" && paths.has(file.path)));
  const size = cited.reduce((total, file) => total + (typeof file.content === "string" ? Buffer.byteLength(file.content, "utf8") : 0), 0);
  const files = size <= limits.maxBytes ? cited : cited.flatMap(file => excerpts(file, ranges.get(String(file.path)) ?? [], limits.windowLines));

  const pull = untrusted.pull && typeof untrusted.pull === "object" ? untrusted.pull as Record<string, unknown> : {};
  const changes = Array.isArray(pull.changes) ? (pull.changes as Array<{ path?: unknown }>).filter(change => typeof change?.path === "string" && paths.has(change.path)) : [];
  const requirements = Array.isArray(pull.requirements) ? (pull.requirements as Array<{ id?: unknown }>).filter(item => typeof item?.id === "string" && criteria.has(item.id)) : [];
  const body = typeof pull.body === "string" ? pull.body : "";
  return {
    pull: {
      ...(typeof pull.title === "string" ? { title: pull.title } : {}),
      body: body.slice(0, limits.bodyChars), ...(body.length > limits.bodyChars ? { bodyTruncated: true } : {}),
      changes, requirements,
    },
    files,
    ...(untrusted.coverage === undefined ? {} : { coverage: untrusted.coverage }),
  };
}

// Line-aligned windows around each cited range, merged where they touch. Cutting on line boundaries
// keeps every excerpt a contiguous run of the file the full scan already read.
function excerpts(file: ContextFile, cited: Array<[number, number]>, windowLines: number): ContextFile[] {
  if (typeof file.content !== "string") return [];
  const lines = file.content.split("\n"), firstLine = Number.isInteger(file.startLine) ? Number(file.startLine) : 1;
  const windows = (cited.length ? cited : [[firstLine, firstLine]] as Array<[number, number]>)
    .map(([start, end]) => [Math.max(firstLine, start - windowLines), Math.min(firstLine + lines.length - 1, end + windowLines)] as [number, number])
    .sort((a, b) => a[0] - b[0])
    .reduce<Array<[number, number]>>((merged, window) => {
      const last = merged.at(-1);
      if (last && window[0] <= last[1] + 1) last[1] = Math.max(last[1], window[1]); else merged.push([...window]);
      return merged;
    }, []);
  return windows.map(([start, end]) => ({ ...file, content: lines.slice(start - firstLine, end - firstLine + 1).join("\n"), startLine: start, endLine: end, excerpt: true }));
}
