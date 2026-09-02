// Nothing in this repository asked the question that matters most: given this diff, does BuildIT
// find this defect? The existing suites cover Autofix fixtures and human-labelling machinery, so a
// false negative on a real pull request went unmeasured until someone read the file by hand.
//
// Every case below is a defect BuildIT was actually asked to review, in the shape it appeared in,
// including one it missed. A case is only useful if the defect is unambiguous to a competent
// reviewer, so each names exactly what a correct finding has to understand.

export type DetectionExpectation = {
  // The file the finding must cite. A finding on the wrong file is not a detection.
  path: string;
  // Any one of these phrases, matched case-insensitively, shows the reviewer understood the defect
  // rather than pattern-matching the file name.
  anyOf: readonly string[];
  severityAtLeast: "info" | "warning" | "high" | "critical";
  blocking: boolean;
};

export type DetectionCase = {
  id: string;
  summary: string;
  // "defect" cases must be found. "clean" cases must NOT produce a blocking finding - without them
  // a grader rewards a reviewer that flags everything.
  kind: "defect" | "clean";
  files: ReadonlyArray<{ path: string; content: string }>;
  expect?: DetectionExpectation;
};

export const detectionCases: ReadonlyArray<DetectionCase> = Object.freeze([
  {
    // Missed in production on 2026-09-02: three runs over this exact code produced the correct
    // finding once, nothing once, and an unrelated coverage finding once.
    id: "det-round-half-cent",
    kind: "defect",
    summary: "Money rounding uses binary floating point, so half-cent values round the wrong way.",
    files: [{
      path: "src/currency.js",
      content: [
        "// Rounds a money amount to two decimals for display.",
        "export function toPaise(amount) {",
        "  return Math.round(amount * 100) / 100;",
        "}",
        "",
        "export function formatINR(amount) {",
        "  return `₹${toPaise(amount).toFixed(2)}`;",
        "}",
        "",
      ].join("\n"),
    }],
    expect: { path: "src/currency.js", anyOf: ["1.005", "floating point", "floating-point", "half", "round"], severityAtLeast: "warning", blocking: true },
  },
  {
    id: "det-unbounded-retry",
    kind: "defect",
    summary: "A retry helper loops forever and swallows every error, so a permanent failure never surfaces.",
    files: [{
      path: "src/retry.js",
      content: [
        "// Retries an operation until it succeeds.",
        "export async function retry(operation, delayMs = 200) {",
        "  while (true) {",
        "    try {",
        "      return await operation();",
        "    } catch {",
        "      await new Promise(resolve => setTimeout(resolve, delayMs));",
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
    }],
    expect: { path: "src/retry.js", anyOf: ["forever", "infinite", "unbounded", "never terminat", "no limit", "swallow"], severityAtLeast: "warning", blocking: true },
  },
  {
    id: "det-tls-disabled",
    kind: "defect",
    summary: "An HTTPS agent disables certificate verification for every outbound request.",
    files: [{
      path: "src/rates.js",
      content: [
        'import https from "node:https";',
        "",
        "const agent = new https.Agent({ rejectUnauthorized: false });",
        "",
        "export async function fetchRates(url) {",
        "  const response = await fetch(url, { agent });",
        "  return response.json();",
        "}",
        "",
      ].join("\n"),
    }],
    expect: { path: "src/rates.js", anyOf: ["certificate", "tls", "man-in-the-middle", "rejectunauthorized", "verification"], severityAtLeast: "critical", blocking: true },
  },
  {
    id: "det-off-by-one-policy",
    kind: "defect",
    summary: "The comparison excludes the qualifying age that the comment three lines above states.",
    files: [{
      path: "src/discount.js",
      content: [
        "// Applies the senior rebate. Policy: the qualifying age is 60 and over.",
        "export function seniorRebate(age, tax) {",
        "  if (age > 60) return tax * 0.9;",
        "  return tax;",
        "}",
        "",
      ].join("\n"),
    }],
    expect: { path: "src/discount.js", anyOf: ["60", "off-by-one", "off by one", "boundary", "qualifying"], severityAtLeast: "warning", blocking: true },
  },
  {
    id: "det-credentials-in-log",
    kind: "defect",
    summary: "A request logger prints every header, which includes the authorization header.",
    files: [{
      path: "src/audit.js",
      content: [
        "export function logRatesRequest(request) {",
        '  console.log("rates request", JSON.stringify({',
        "    url: request.url,",
        "    method: request.method,",
        "    headers: request.headers,",
        "  }));",
        "}",
        "",
      ].join("\n"),
    }],
    expect: { path: "src/audit.js", anyOf: ["header", "credential", "token", "authorization", "secret"], severityAtLeast: "high", blocking: true },
  },
  {
    // A reviewer that flags everything scores perfectly on defect cases alone. This is the control.
    id: "det-clean-tax",
    kind: "clean",
    summary: "Correct, well-guarded tax brackets with an explicit boundary. Nothing here should block.",
    files: [{
      path: "src/tax.js",
      content: [
        "export function calculateTax(amount) {",
        '  if (!Number.isFinite(amount)) throw new TypeError("amount must be a finite number");',
        '  if (amount < 0) throw new RangeError("amount must be non-negative");',
        "  if (amount <= 100) return amount * 0.1;",
        "  return 10 + (amount - 100) * 0.2;",
        "}",
        "",
      ].join("\n"),
    }],
  },
]);

export const detectionCaseIds = Object.freeze(detectionCases.map(item => item.id));
