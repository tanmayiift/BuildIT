// Two pages counted the same thing differently. The repository summary counted a finding as
// blocking while its resolution was "open"; the run-history panel counted it while its resolution
// was anything other than "dismissed". Those agree right up until a finding is fixed by Autofix or
// accepted by a person - at which point the summary drops it to zero and the history panel still
// calls it blocking.
//
// That is not a cosmetic disagreement, because reviewHistory sorts the triage queue by this number.
// A pull request whose blocking findings had all been fixed kept its place at the top of the list,
// above ones with real work outstanding, for as long as the rows survived.
//
// The comment above the sort in reviewHistory.ts already said it: a number computed twice is a
// number that disagrees with itself eventually. So it is computed once, here.
//
// "open" is the resolution arbitration writes for an accepted finding, and it is the only state in
// which a finding is still asking somebody to do something.
export function blockingFindingCount(findings: ReadonlyArray<{ blocking: boolean; resolution: string }>) {
  return findings.filter(item => item.blocking && item.resolution === "open").length;
}
