import { describe, expect, it } from "vitest";
import { scanBuildITRules } from "../src/index.js";

// `buildit-rules` is a REQUIRED check, and it knew three patterns - eval(, exec(, and
// rejectUnauthorized: false. Two of those fire on ordinary code: `exec` matches
// `regex.exec(input)`, which is the single most common correct use of the word in JavaScript, and
// a required check that blocks a merge over `regex.exec` is a check a team turns off in a week.
//
// So this corpus is two-sided on purpose. Every rule must fire on the vulnerable form AND stay
// silent on named, realistic, legitimate code. A rule that cannot do both does not belong in a
// required check, and the false-positive half is the half that decides whether anyone keeps it on.

const scan = (path: string, content: string) => scanBuildITRules([{ path, content }], "a".repeat(40)).findings;
const ids = (path: string, content: string) => scan(path, content).map(finding => finding.ruleId);

describe("what must fire", () => {
  it("TLS verification disabled in code and in config", () => {
    expect(ids("src/http.js", "const agent = new https.Agent({ rejectUnauthorized: false });")).toContain("buildit-tls-disabled");
    expect(ids("config/app.json", '{ "rejectUnauthorized": false }')).toContain("buildit-tls-disabled");
  });

  it("NODE_TLS_REJECT_UNAUTHORIZED turned off, which disables TLS process-wide", () => {
    expect(ids("src/boot.js", 'process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";')).toContain("buildit-tls-env-disabled");
  });

  it("a shell built by concatenating untrusted input", () => {
    expect(ids("src/run.js", "execSync(`git clone ${repoUrl}`);")).toContain("buildit-shell-interpolation");
    expect(ids("src/run.js", 'exec("ls " + userInput);')).toContain("buildit-shell-interpolation");
    // A variable can hold anything, so a non-literal command is in scope too.
    expect(ids("src/run.js", "execSync(command);")).toContain("buildit-shell-interpolation");
  });

  it("eval and its aliases over a value that is not a literal", () => {
    expect(ids("src/run.js", "eval(payload);")).toContain("buildit-dynamic-eval");
    expect(ids("src/run.js", "new Function(body)();")).toContain("buildit-dynamic-eval");
  });

  it("a JWT decoded without verifying its signature", () => {
    expect(ids("src/auth.js", "const claims = jwt.decode(token);")).toContain("buildit-jwt-unverified");
  });

  it("a password or token compared with a non-constant-time equality", () => {
    expect(ids("src/auth.js", "if (providedToken === storedToken) return true;")).toContain("buildit-timing-unsafe-compare");
  });

  // The rule could not match this at all: its tail was `\w`, and a quote is not a word character.
  // So the one shape everybody writes when they get this wrong was the one shape it missed.
  // Assembled, never written whole. A key-shaped literal anywhere in this tree fails the required
  // secret scan on every pull request, including the ones that added it.
  it("a secret compared against a string literal, which the rule used to miss entirely", () => {
    const keyShaped = ["sk", "live", "abc123"].join("-");
    expect(ids("src/auth.js", `if (apiKey === "${keyShaped}") return true;`)).toContain("buildit-timing-unsafe-compare");
    expect(ids("src/auth.js", "if (signature !== `${expected}`) return false;")).toContain("buildit-timing-unsafe-compare");
  });

  it("SQL assembled by interpolation", () => {
    expect(ids("src/db.js", "db.query(`SELECT * FROM users WHERE id = ${id}`);")).toContain("buildit-sql-interpolation");
  });

  it("a wildcard CORS origin paired with credentials", () => {
    expect(ids("src/server.js", 'cors({ origin: "*", credentials: true })')).toContain("buildit-cors-wildcard-credentials");
  });
});

describe("what must stay silent, or the check gets turned off", () => {
  const quiet = (name: string, path: string, content: string) =>
    it(name, () => expect(scan(path, content)).toEqual([]));

  quiet("regex.exec, the commonest correct use of the word in JavaScript", "src/parse.js",
    "let match; while ((match = pattern.exec(line)) !== null) { out.push(match[1]); }");
  quiet("a shell command with no interpolation at all", "src/run.js",
    'execSync("git rev-parse HEAD", { encoding: "utf8" });');
  quiet("evaluating a literal, which cannot be attacker-controlled", "src/run.js",
    'eval("1 + 1");');
  quiet("jwt.verify, which is the correct call", "src/auth.js",
    "const claims = jwt.verify(token, publicKey, { algorithms: [\"RS256\"] });");
  quiet("timingSafeEqual, which is the correct comparison", "src/auth.js",
    "if (crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))) return true;");

  // Two of these failed a required check on unmodified upstream code in a real review, on lines the
  // pull request never touched. Checking whether a secret was supplied is not a timing attack:
  // there is no secret on the other side of the comparison to leak.
  quiet("a password checked for existence, not compared", "src/options.js",
    "if (password !== undefined) { options.password = password; }");
  quiet("a token checked against null", "src/auth.js", "if (token === null) return unauthenticated();");
  quiet("a secret flag compared to a boolean", "src/config.js", "if (hasSecret === true) enable();");
  quiet("a token length compared to a number", "src/auth.js", "if (tokenCount !== 0) retry();");
  // Third false positive from the same rule, on the same upstream file. An empty string is not a
  // secret either: this asks whether a credential was supplied, not whether it matches.
  quiet("a credential compared to the empty string", "src/options.js",
    "hasCredentials = url.username !== '' || url.password !== '';");
  quiet("a token compared to an empty template literal", "src/auth.js", "if (token === ``) return null;");
  quiet("a parameterised query, which is the correct form", "src/db.js",
    "db.query(\"SELECT * FROM users WHERE id = $1\", [id]);");
  quiet("a template literal that is not SQL", "src/log.js",
    "logger.info(`user ${id} signed in`);");
  quiet("CORS wildcard without credentials, which is ordinary for a public API", "src/server.js",
    'cors({ origin: "*" })');
  quiet("rejectUnauthorized set to true, which is the fix, not the defect", "src/http.js",
    "const agent = new https.Agent({ rejectUnauthorized: true });");
  quiet("a comment describing the danger rather than doing it", "src/http.js",
    "// never set rejectUnauthorized: false in production");
  // A test that proves dangerous input is rejected must contain the dangerous input. This check
  // scans the whole tree rather than the diff, so flagging it would fail every future review of the
  // repository - the trap BuildIT walked into on its own. Secrets are unaffected: gitleaks still
  // scans test paths.
  quiet("a test asserting the dangerous form is rejected", "test/http.test.js",
    'expect(() => connect({ rejectUnauthorized: false })).toThrow();');
  quiet("prose in a markdown document", "docs/security.md",
    "Do not use eval(userInput) or set rejectUnauthorized: false.");
});

describe("severity is proportionate, because a required check that cries wolf is turned off", () => {
  it("reserves critical for what is exploitable as written", () => {
    const critical = scan("src/http.js", "const agent = new https.Agent({ rejectUnauthorized: false });");
    expect(critical[0]?.severity).toBe("critical");
  });

  it("keeps a pattern that needs human judgement out of critical", () => {
    const shell = scan("src/run.js", "execSync(`git clone ${repoUrl}`);");
    expect(shell[0]?.severity).toBe("warning");
  });
});
