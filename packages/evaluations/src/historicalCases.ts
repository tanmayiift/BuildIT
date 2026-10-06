// The evaluation criterion asked for a labelled set of real pull requests with expected outcomes,
// and read the existing work as absent. That reading was right about the important part.
// detectionCases.ts holds six defects as inline string literals - five to nine lines each, written
// to be found. A model that scores well on them has demonstrated it can read a snippet.
//
// These are different in the way that matters: ten real pull requests against snapshots of
// sindresorhus/p-queue, expressjs/body-parser, psf/requests, pallets/itsdangerous, google/gson,
// axios/axios, sindresorhus/got, expressjs/express, colinhacks/zod and date-fns - four languages,
// hundreds of files each, one deliberate defect planted per pull request and every one of them
// verified to actually reproduce before it was labelled here.
//
// The labels are ground truth rather than a transcript of what BuildIT said. Each defect was
// planted, so what a correct finding must understand is known independently of whether BuildIT
// found it - which is the difference between an evaluation set and a regression snapshot. Two of
// these are already known misses, and they stay in the set for exactly that reason.
//
// Every case also carries a test that passes despite the defect, because that is what the real
// failures looked like: got's retry test asserted `attempts >= 1`, which a correct implementation
// and a broken one both satisfy.

import { createHash } from "node:crypto";
import type { DetectionExpectation } from "./detectionCases.js";

export type DefectFamily =
  | "concurrency" | "error_handling" | "configuration_architecture" | "authorization_tenant"
  | "logic_edge_case" | "performance_resource" | "regression";

export type HistoricalCase = {
  id: string;
  // The pull request a reader can open. This is the whole point: an evaluation set nobody can
  // inspect is a spreadsheet of assertions.
  url: string;
  repository: string;
  upstream: string;
  // The upstream commit the demo repository was snapshotted from, recorded only where it was verified
  // to exist upstream. Four v1 values did not exist anywhere (their tails repeated "...e0a5e1c9e0...")
  // and were removed in v2 rather than replaced with a guess.
  upstreamSha?: string;
  // The exact commits a run reviews. A benchmark run refuses to start if the pull request's head has
  // moved, because a different head is a different case.
  headSha: string;
  baseSha: string;
  language: "typescript" | "javascript" | "python" | "java";
  kind: "defect" | "clean";
  defectFamily?: DefectFamily;
  // What was planted, in one sentence, and what a correct finding has to understand about it. The
  // second half is the label that matters: naming the right file is not detection if the reasoning
  // is wrong, which is why `expect.anyOf` exists rather than a path match alone.
  summary: string;
  mustUnderstand?: string;
  // Why the added test does not catch it. Every one of these passes on the broken code.
  testBlindSpot?: string;
  expect?: DetectionExpectation;
};

// v2 (6 Oct 2026): every case pins its pull request's head and base; zod's expectation moved to where
// the defect is planted (util.ts, compile.ts - v1 named checks.ts, which never contained it) and to
// "high", because only critical and high findings block; four fabricated upstream SHAs were removed.
export const historicalSetVersion = "historical-v2";

export const historicalCases: ReadonlyArray<HistoricalCase> = Object.freeze([
  {
    id: "hist-p-queue-weighted-concurrency",
    url: "https://github.com/tanmayiift/buildit-demo-p-queue/pull/2",
    headSha: "9e3b575d34337096376546a7bf93075aec6dbfc0",
    baseSha: "6b1578284fe3bc9dc09a72c6475988d04eb3cabc",
    repository: "tanmayiift/buildit-demo-p-queue",
    upstream: "sindresorhus/p-queue@v9.3.3",
    upstreamSha: "180ab9e25cd10b6f548767d7176076b50d25e188",
    language: "typescript",
    kind: "defect",
    defectFamily: "concurrency",
    summary: "A weight option is documented as capping total running weight at the concurrency limit, but the admission check asks whether there is any room rather than enough room.",
    mustUnderstand: "This is the classic weighted-semaphore error, and it cannot be fixed in place: the gate runs before the queue is dequeued, so the next job's weight is not yet visible.",
    testBlindSpot: "The added tests order the heavy task first, which never trips the limit. Reproduces at concurrency 2 with weight 1 followed by weight 2.",
    expect: { path: "source/index.ts", anyOf: ["weight", "concurrency", "pendingWeight", "enough room"], severityAtLeast: "high", blocking: true },
  },
  {
    id: "hist-body-parser-async-verify-bypass",
    url: "https://github.com/tanmayiift/buildit-demo-body-parser/pull/6",
    headSha: "b6485bc3ffc80565968c034a1d4b6a8836dd68a3",
    baseSha: "b47739fcb5b6003961eb6b304f0d882390670935",
    repository: "tanmayiift/buildit-demo-body-parser",
    upstream: "expressjs/body-parser@v2.3.0",
    upstreamSha: "d0f2ace6c74769da7d19b8661b9a01c01bdb0bf7",
    language: "javascript",
    kind: "defect",
    defectFamily: "error_handling",
    summary: "An async verify callback's rejection is caught but not awaited or returned, so a failed signature check does not stop the request.",
    mustUnderstand: "This is a signature-check bypass, not a logging bug: a rejecting verify yields HTTP 200 with the parsed body, and the 403 arrives on an already-answered request.",
    testBlindSpot: "The added test uses a resolving async verify. All 270 existing tests pass.",
    expect: { path: "lib/read.js", anyOf: ["verify", "await", "promise", "reject", "bypass"], severityAtLeast: "critical", blocking: true },
  },
  {
    id: "hist-requests-env-ca-override",
    url: "https://github.com/tanmayiift/buildit-demo-requests/pull/3",
    headSha: "b15a9957ed9b6d9f2f714e8df5b18b519974d5ba",
    baseSha: "52187cd6f52f61ca94a0661a773dafcbe77067d0",
    repository: "tanmayiift/buildit-demo-requests",
    upstream: "psf/requests@v2.34.2",
    upstreamSha: "6e83187b8feb273ed4c6cdab5efd8d54901dfab3",
    language: "python",
    kind: "defect",
    defectFamily: "configuration_architecture",
    summary: "The guard changed from `verify is True or verify is None` to `verify is not False`, so an environment CA bundle silently replaces a caller-pinned certificate path.",
    mustUnderstand: "verify is tri-typed - True, False, or a path string - and the original spelling existed precisely so a caller-supplied CA path is never overridden by the environment.",
    testBlindSpot: "All 13 existing env-cert-bundle tests pass because every one of them passes verify=True.",
    expect: { path: "src/requests/sessions.py", anyOf: ["verify", "CA bundle", "REQUESTS_CA_BUNDLE", "override", "environment"], severityAtLeast: "critical", blocking: true },
  },
  {
    id: "hist-itsdangerous-salt-ignored",
    url: "https://github.com/tanmayiift/buildit-demo-itsdangerous/pull/3",
    headSha: "93d85abc05113ae977b9185e4d35001105ed2a37",
    baseSha: "56804ea4a23ba4215bd30d4fa2ea4160e8b4b20a",
    repository: "tanmayiift/buildit-demo-itsdangerous",
    upstream: "pallets/itsdangerous@2.2.0",
    upstreamSha: "096c8d42545d3b68ea21a4f890fb2b2d8979c0bd",
    language: "python",
    kind: "defect",
    defectFamily: "authorization_tenant",
    summary: "A per-call salt parameter is threaded into three key-derivation branches but not into django-concat, which is the default.",
    mustUnderstand: "Connecting those two facts is the finding: because the untouched branch is the default, the new salt argument does nothing unless a caller opted out of the default, so a token minted for one namespace validates in another.",
    testBlindSpot: "The added isolation test uses key_derivation=\"hmac\", which does honour the salt. 309 tests pass.",
    expect: { path: "src/itsdangerous/signer.py", anyOf: ["salt", "django-concat", "default_key_derivation", "derive_key"], severityAtLeast: "critical", blocking: true },
  },
  {
    id: "hist-gson-millisecond-carry",
    url: "https://github.com/tanmayiift/buildit-demo-gson/pull/3",
    headSha: "436ddbc3f2e3eb1183991f140dc11bd54332571a",
    baseSha: "ae80259aef40b98f321f29f3077d44fce8b4077f",
    repository: "tanmayiift/buildit-demo-gson",
    upstream: "google/gson@gson-parent-2.14.0",
    upstreamSha: "3ff35d6269894901ab8006258395aafc4b9765cd",
    language: "java",
    kind: "defect",
    defectFamily: "logic_edge_case",
    summary: "Rounding fractional seconds can produce 1000 milliseconds with no clamp or carry, and the calendar it is fed is non-lenient.",
    mustUnderstand: "The calendar's setLenient(false) is outside the diff hunk, so the finding requires reading past the change. Any RFC 3339 timestamp in the last half-millisecond of a second then fails to parse the whole document.",
    testBlindSpot: "No existing gson test uses four or more fractional digits.",
    expect: { path: "gson/src/main/java/com/google/gson/internal/bind/util/ISO8601Utils.java", anyOf: ["millisecond", "1000", "carry", "lenient", "round"], severityAtLeast: "high", blocking: true },
  },
  {
    id: "hist-axios-evicted-session-leak",
    url: "https://github.com/tanmayiift/buildit-demo-axios/pull/2",
    headSha: "f0c6fed4a4f6a0c22638b1e94b18e8dbf7372a7c",
    baseSha: "03bd1b593a4601fcc972f4e763665297ba223eb8",
    repository: "tanmayiift/buildit-demo-axios",
    upstream: "axios/axios@v1.20.0",
    upstreamSha: "84a9f3b9a4f3244b8c8e818f557d64c7b964fb25",
    language: "javascript",
    kind: "defect",
    defectFamily: "performance_resource",
    summary: "A new cap on pooled HTTP/2 sessions evicts the oldest entry without closing it, so the socket and its idle timer survive for the process lifetime.",
    mustUnderstand: "The code comments claim the session's own handlers tear it down; the finding requires tracing removeSession and seeing that its close call sits inside a branch an evicted session never reaches. The cap is therefore strictly worse than the unbounded pool it replaced.",
    testBlindSpot: "Nothing asserts that an evicted session was closed. After 20 sessions with a cap of 8, all 12 evicted sessions remain open.",
    expect: { path: "lib/helpers/Http2Sessions.js", anyOf: ["close", "destroy", "leak", "evict", "shift"], severityAtLeast: "high", blocking: true },
  },
  {
    id: "hist-got-retry-budget",
    url: "https://github.com/tanmayiift/buildit-demo-got/pull/1",
    headSha: "fda2b11203db8abac683e1c190bc536dbfb05a38",
    baseSha: "bc0655188b888a62e521966ad21a891f81b0554e",
    repository: "tanmayiift/buildit-demo-got",
    upstream: "sindresorhus/got",
    language: "typescript",
    kind: "defect",
    defectFamily: "regression",
    summary: "totalRetryTimeout is documented as a budget across all attempts but is measured from the most recent attempt's start, so it never bounds total wall-clock time.",
    mustUnderstand: "error.timings.start belongs to the attempt that just failed, not to the first attempt, and no first-attempt deadline is persisted anywhere - so the check resets on every retry instead of accumulating.",
    testBlindSpot: "The added test asserts only that the request eventually throws and that attempts >= 1, which a correct implementation and a broken one both satisfy.",
    expect: { path: "source/core/calculate-retry-delay.ts", anyOf: ["retry", "elapsed", "timings.start", "budget", "accumulate"], severityAtLeast: "high", blocking: true },
  },
  {
    id: "hist-express-view-cache-key",
    url: "https://github.com/tanmayiift/buildit-demo-express/pull/7",
    headSha: "b7676205c25e56ba7188a9143f58b9c853b0886a",
    baseSha: "9323e2578c602d9a588f07183450b937de39aa4d",
    repository: "tanmayiift/buildit-demo-express",
    upstream: "expressjs/express",
    upstreamSha: "f540c3b0195393974d4875a410f4c00a07a2ab60",
    language: "javascript",
    kind: "defect",
    defectFamily: "logic_edge_case",
    summary: "A per-render root option is added while the view cache stays keyed on the template name alone, so two renders of the same template name from different roots collide.",
    mustUnderstand: "The cache key must include every input that changes which file is resolved. The second render silently returns the first root's template.",
    testBlindSpot: "No test renders the same template name from two different roots in one process.",
    expect: { path: "lib/application.js", anyOf: ["cache", "key", "root", "collide", "name"], severityAtLeast: "high", blocking: true },
  },
  {
    id: "hist-zod-int16-off-by-one",
    url: "https://github.com/tanmayiift/buildit-demo-zod/pull/1",
    headSha: "7135ab84a53917ed78739a52efdc9186401d345c",
    baseSha: "1a295bdeca5b9cd676b8897b3c1ccd9f301bfbb4",
    repository: "tanmayiift/buildit-demo-zod",
    upstream: "colinhacks/zod",
    language: "typescript",
    kind: "defect",
    defectFamily: "logic_edge_case",
    summary: "int16's upper bound is written as 32768 rather than 32767, in both the bounds table and the compiled fast path, so z.int16() accepts a value one past the type's maximum.",
    mustUnderstand: "A signed 16-bit integer's maximum is 2^15 - 1. The same off-by-one appears twice, so a fix in one place leaves the other wrong, and the compiled path is the one that runs.",
    testBlindSpot: "The added tests assert 32767 parses and never assert 32768 is rejected.",
    // The defect is planted in the bounds table (util.ts NUMBER_FORMAT_RANGES) and repeated in the
    // compiled fast path (compile.ts), as the summary says; v1 named checks.ts, which never held it.
    // High: z.int16() accepting a value outside int16 breaks the validator's core contract.
    expect: { path: "packages/zod/src/v4/core/util.ts", alsoPaths: ["packages/zod/src/v4/core/compile.ts"], anyOf: ["32767", "32768", "off-by-one", "int16", "bound", "NUMBER_FORMAT_RANGES"], severityAtLeast: "high", blocking: true },
  },
  {
    id: "hist-date-fns-holiday-whole-week",
    url: "https://github.com/tanmayiift/buildit-demo-date-fns/pull/1",
    headSha: "c2c5b8436cf510ccf5ee9fcbf08ab8dc233f3489",
    baseSha: "5b96b04f15d200b3d57184756e15db27a2d66300",
    repository: "tanmayiift/buildit-demo-date-fns",
    upstream: "date-fns/date-fns",
    language: "typescript",
    // Labelled "clean" when this set was written, and that label was wrong. I read the diff, saw
    // holidays normalized through the right context and a weekend holiday correctly not
    // double-counted, and stopped there - without reading the function the diff sits inside.
    //
    // differenceInBusinessDays has a whole-week fast path: `result = weeks * 5`, then it advances
    // movingDate by `weeks * 7` and only iterates the remainder. Holidays are tested only inside
    // that remainder loop, so a holiday falling in a complete week is never subtracted. BuildIT
    // found it on findings-v2 and it is correct.
    //
    // The set now has no clean control, which is a real weakness: false blocking cannot be
    // measured until one is added, and it is the outcome this scoring treats as worse than a miss.
    kind: "defect",
    defectFamily: "logic_edge_case",
    summary: "Holiday support is added to differenceInBusinessDays, but holidays are only checked in the remainder loop after the whole-week fast path, so a holiday inside a complete week is silently ignored.",
    mustUnderstand: "The defect is not in the added lines. It is that the function computes whole weeks in bulk before the loop the holiday check was added to, so the check never sees most of the range.",
    testBlindSpot: "Both added tests span less than a week (Wed-Fri and Fri-Tue), so neither crosses the whole-week fast path at all.",
    expect: { path: "pkgs/core/src/differenceInBusinessDays/index.ts", anyOf: ["whole week", "weeks * 5", "fast path", "remainder", "complete week"], severityAtLeast: "high", blocking: true },
  },
  {
    id: "hist-express-utils-unit-coverage",
    url: "https://github.com/tanmayiift/buildit-demo-express/pull/9",
    headSha: "4c36848048f7db2114252ab994e499ca0fc983a3",
    baseSha: "9323e2578c602d9a588f07183450b937de39aa4d",
    repository: "tanmayiift/buildit-demo-express",
    upstream: "expressjs/express",
    language: "javascript",
    // The clean control, replacing the date-fns case that turned out to be a defect. Without one
    // the set rewards a reviewer that flags everything, and false blocking - the outcome scored as
    // worse than a miss - cannot be measured at all.
    //
    // Test-only on purpose: 203 added lines, all in test/utils.js, nothing under lib/. That makes
    // "no defect" structural rather than argued - there is no runtime behaviour to get wrong, so
    // the only way it could be defective is a false assertion, and all 53 pass on 22 Node and
    // platform combinations. The assertions were also mutation-tested against seven deliberate
    // breakages of lib/utils.js and every one was caught, so they are not vacuous either.
    //
    // The known trade: this control has no production diff, so it does not test whether BuildIT
    // over-flags a real code change. That gap is open.
    kind: "clean",
    summary: "Adds 203 lines of unit tests for three previously untested helpers in lib/utils.js. No production file is touched.",
    testBlindSpot: "Not applicable: there is no defect for a test to miss. Recorded so the shape of this entry matches the others.",
  },
]);

export const historicalDefectCount = historicalCases.filter(item => item.kind === "defect").length;
export const historicalCleanCount = historicalCases.filter(item => item.kind === "clean").length;

// What a benchmark run was scored against: every field that decides an outcome, hashed. A run file
// records it and scoring refuses a file whose digest differs, so a label edited between a baseline
// and a candidate run cannot pass for a prompt improvement.
export function historicalLabelDigest(cases: ReadonlyArray<HistoricalCase> = historicalCases) {
  const labels = cases.map(item => ({ id: item.id, url: item.url, headSha: item.headSha, baseSha: item.baseSha, kind: item.kind, expect: item.expect ?? null }));
  return createHash("sha256").update(JSON.stringify(labels)).digest("hex");
}
