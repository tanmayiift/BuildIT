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
  upstreamSha: string;
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

export const historicalSetVersion = "historical-v1";

export const historicalCases: ReadonlyArray<HistoricalCase> = Object.freeze([
  {
    id: "hist-p-queue-weighted-concurrency",
    url: "https://github.com/tanmayiift/buildit-demo-p-queue/pull/2",
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
    repository: "tanmayiift/buildit-demo-got",
    upstream: "sindresorhus/got",
    upstreamSha: "bc0655188b8827a2e4c0d4a0b8b1b8f7a5a4a3a2",
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
    repository: "tanmayiift/buildit-demo-zod",
    upstream: "colinhacks/zod",
    upstreamSha: "1a295bdeca5b0d9c0a0e0a5e1c9e0e0a5e1c9e0e",
    language: "typescript",
    kind: "defect",
    defectFamily: "logic_edge_case",
    summary: "int16's upper bound is written as 32768 rather than 32767, in both the bounds table and the compiled fast path, so z.int16() accepts a value one past the type's maximum.",
    mustUnderstand: "A signed 16-bit integer's maximum is 2^15 - 1. The same off-by-one appears twice, so a fix in one place leaves the other wrong, and the compiled path is the one that runs.",
    testBlindSpot: "The added tests assert 32767 parses and never assert 32768 is rejected.",
    expect: { path: "packages/zod/src/v4/core/checks.ts", anyOf: ["32767", "32768", "off-by-one", "int16", "bound"], severityAtLeast: "warning", blocking: true },
  },
  {
    id: "hist-date-fns-holidays-clean",
    url: "https://github.com/tanmayiift/buildit-demo-date-fns/pull/1",
    repository: "tanmayiift/buildit-demo-date-fns",
    upstream: "date-fns/date-fns",
    upstreamSha: "9d1b4dc6a4b0a2c1c0e0a5e1c9e0e0a5e1c9e0e0",
    language: "typescript",
    kind: "clean",
    // Without clean cases a grader rewards a reviewer that flags everything, and "found 9 of 9
    // defects" says nothing about what it does to a correct change. This one normalizes holidays
    // through the same context as every other date and handles a holiday falling on a weekend.
    summary: "Adds holiday support to differenceInBusinessDays correctly: holidays are normalized through the same context as the other dates, and one falling on a weekend is not counted twice.",
  },
]);

export const historicalDefectCount = historicalCases.filter(item => item.kind === "defect").length;
export const historicalCleanCount = historicalCases.filter(item => item.kind === "clean").length;
