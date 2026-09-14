import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { defaultExecutionPlans, SANDBOX_DIAGNOSTIC_RERUN_LIMIT, SANDBOX_JOB_LIFETIME_MS, type CommandPlan } from "../src/index";
import { diagnosticRerunAllowed, VercelSandboxRunner, type SandboxFactory, type SandboxLike, type SegmentOutcome } from "../src/vercelSandbox";
import { executionSandboxName, firstExecutionSegment, nextExecutionSegment, segmentRunsInSandbox, type ExecutionSegment, type SegmentPlanState } from "../src/executionSegments";

function fixture(options: { env?: string; installExit?: number; testExits?: number[]; osvExit?: number; osvOutput?: string; osvStderr?: string; gitleaksOutput?: string; testDurationMs?: number; installDurationMs?: number; omitTestDuration?: boolean; gitleaksExit?: number; gitleaksReportBytes?: number; gitleaksReportMissing?: boolean; installThrows?: boolean } = {}) {
  const calls: Array<unknown> = [], stop = vi.fn(async () => ({})), remove = vi.fn(async () => ({}));
  const sandbox: SandboxLike = {
    writeFiles: vi.fn(async files => { calls.push(["files", files]); }),
    readFileToBuffer: vi.fn(async file => {
      if (file.path.includes("osv")) return Buffer.from('{"results":[]}');
      if (options.gitleaksReportMissing) return null;
      return options.gitleaksReportBytes ? Buffer.alloc(options.gitleaksReportBytes) : Buffer.from("[]");
    }),
    updateNetworkPolicy: vi.fn(async policy => { calls.push(["network", policy]); }),
    runCommand: vi.fn(async command => {
      calls.push(["command", command]);
      const isEnv = command.cmd === "env", isOsv = command.cmd === "osv-scanner", isGitleaks = command.cmd === "gitleaks", isTest = command.cmd === "pnpm" && command.args[0] === "run" && command.args[1] === "test", isInstall = command.cmd === "pnpm" && command.args[0] === "install";
      if (isInstall && options.installThrows) throw new Error("registry timed out");
      const exitCode = isEnv ? 0 : isOsv ? options.osvExit ?? 0 : isGitleaks ? options.gitleaksExit ?? 0 : isInstall ? options.installExit ?? 0 : isTest ? options.testExits?.shift() ?? 0 : 0;
      const durationMs = isTest ? options.testDurationMs ?? 10 : isInstall ? options.installDurationMs ?? 10 : 10;
      const stream = { stdout: async () => isEnv ? options.env ?? "CI=true\n" : isOsv ? options.osvOutput ?? "ok" : isGitleaks ? options.gitleaksOutput ?? "ok" : "ok", stderr: async () => isOsv ? options.osvStderr ?? "" : "" };
      // The SDK declares durationMs optional on CommandFinished and passes the API value straight
      // through, so a kill can arrive with no duration at all.
      return isTest && options.omitTestDuration ? { exitCode, ...stream } : { exitCode, durationMs, ...stream };
    }),
    stop,
    delete: remove,
  };
  return { sandbox, calls, stop, remove, create: vi.fn(async (_input: Parameters<SandboxFactory>[0]) => sandbox) };
}

type ReviewInput = { runtime: "node22" | "node24"; image?: string; credentials?: { token: string; teamId: string; projectId: string }; files: Array<{ path: string; content: string }>; install?: CommandPlan; checks: CommandPlan[] };
type Review = SegmentOutcome & { segments: ExecutionSegment[] };

/**
 * Drives one revision through every segment of a review, which is what the Convex worker does for
 * base and head in parallel. It exists so these tests still assert the behaviour of a whole review
 * rather than of one HTTP request, now that no single call performs one.
 */
async function review(runner: VercelSandboxRunner, input: ReviewInput, jobKey = "validation:review-a:0:head"): Promise<Review> {
  const state: SegmentPlanState = { checks: input.checks, installable: Boolean(input.install), installed: [], diagnostics: [] };
  const merged: Review = { results: [], outputs: [], diagnostics: {}, segments: [] };
  let segment: ExecutionSegment | null = firstExecutionSegment();
  while (segment) {
    if (segmentRunsInSandbox(segment, state)) {
      merged.segments.push(segment);
      const outcome = await runner.runSegment({ ...input, segment, revision: "base", sandboxName: executionSandboxName(jobKey, "base") });
      merged.results.push(...outcome.results);
      merged.outputs.push(...outcome.outputs);
      for (const [planId, runs] of Object.entries(outcome.diagnostics)) merged.diagnostics[planId as "test"] = [...(merged.diagnostics[planId as "test"] ?? []), ...runs];
      for (const key of ["credentialTeardownProved", "stopped", "gitleaksReport", "osvReport", "unavailableScanners", "unavailableReason"] as const) {
        if (outcome[key] !== undefined) Object.assign(merged, { [key]: outcome[key] });
      }
      if (segment.stage === "install") state.installed = merged.results.some(item => item.planId === "install" && item.conclusion === "passed") ? ["base"] : [];
      if (segment.stage === "checks") {
        state.diagnostics = input.checks.filter(plan => plan.required && diagnosticRerunAllowed(merged.diagnostics[plan.planId] ?? [], 1 + SANDBOX_DIAGNOSTIC_RERUN_LIMIT))
          .map(plan => ({ planId: plan.planId, revisions: ["base" as const] }));
      }
    }
    segment = nextExecutionSegment(segment, state);
  }
  return merged;
}

const commands = (calls: Array<unknown>) => (calls as Array<[string, { cmd?: string; args?: string[] }]>).filter(call => call[0] === "command");

describe("Vercel sandbox runner", () => {
  const plans = defaultExecutionPlans("pnpm"), install = plans.install, test = plans.checks[0]!;

  it("writes fetched files without a GitHub token, permits only install registries, then denies all network", async () => {
    const f = fixture(), runner = new VercelSandboxRunner(f.create);
    const result = await review(runner, { runtime: "node22", files: [{ path: "package.json", content: "{}" }, { path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: [test] });
    expect(result.credentialTeardownProved).toBe(true);
    expect(result.gitleaksReport).toBe("[]");
    expect(result.osvReport).toBe('{"results":[]}');
    expect(result.outputs).toEqual([{ planId: "install", text: "ok", truncated: false }, { planId: "test", text: "ok", truncated: false }]);
    expect(f.calls).toContainEqual(["network", { allow: ["registry.npmjs.org", "registry.yarnpkg.com", "npm.jsr.io"] }]);
    expect(f.calls).toContainEqual(["network", "deny-all"]);
    expect(f.calls).toContainEqual(["command", { cmd: "pnpm", args: ["install", "--frozen-lockfile", "--ignore-scripts"], cwd: "/vercel/sandbox/repo", timeoutMs: 150_000 }]);
    expect(f.calls).toContainEqual(["command", { cmd: "osv-scanner", args: ["scan", "source", "--offline", "--no-resolve", "--format", "json", "--output", "/tmp/buildit-osv.json", "--lockfile", "/vercel/sandbox/repo/pnpm-lock.yaml"], cwd: "/vercel/sandbox/repo", timeoutMs: 50_000 }]);
    expect(f.create.mock.calls[0]![0]).toMatchObject({ timeout: SANDBOX_JOB_LIFETIME_MS, networkPolicy: "deny-all", env: { CI: "true" }, region: "cdg1", persistent: true });
  });

  // The whole point of the split. Every segment addresses the sandbox by the same derived name and
  // opens it with getOrCreate, so the install one segment paid for is still there when the next one
  // runs its tests. A per-call sandbox would make install 150 seconds of every segment, which is
  // what does not fit a 300 second function.
  it("resumes one named sandbox across every segment instead of building a new one per call", async () => {
    const f = fixture(), runner = new VercelSandboxRunner(f.create);
    const result = await review(runner, { runtime: "node24", files: [{ path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: plans.checks });
    expect(result.segments.map(segment => segment.stage)).toEqual(["prepare", "scanners", "install", "checks", "checks", "checks", "compare"]);
    const names = new Set(f.create.mock.calls.map(call => call[0]!.name));
    expect(names.size).toBe(1);
    expect([...names][0]).toMatch(/^buildit-[0-9a-f]{32}$/);
    // Exactly one install command, for four segments that each needed the installed tree.
    expect(commands(f.calls).filter(call => call[1].args?.[0] === "install")).toHaveLength(1);
  });

  // A sandbox that survives its request is a sandbox that can be orphaned, which the previous shape
  // made impossible by construction. Teardown happens once, on the terminal segment, and its own
  // timeout is what covers every path that never reaches one.
  it("tears the sandbox down only on the terminal segment, and deletes the name rather than parking it", async () => {
    const f = fixture(), runner = new VercelSandboxRunner(f.create);
    const segments = ["prepare", "scanners", "install", "checks"] as const;
    for (const stage of segments) {
      await runner.runSegment({ runtime: "node24", files: [{ path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: [test], revision: "base", sandboxName: "buildit-fixed", segment: stage === "checks" ? { stage, index: 0, planId: "test", revisions: ["base"] } : { stage, index: 0 } });
      expect(f.stop, stage).not.toHaveBeenCalled();
      expect(f.remove, stage).not.toHaveBeenCalled();
    }
    const released = await runner.runSegment({ runtime: "node24", files: [], install, checks: [test], revision: "base", sandboxName: "buildit-fixed", segment: { stage: "compare", index: 0 } });
    expect(released.stopped).toBe(true);
    // Stopping a named persistent sandbox keeps its name and its snapshot, so the next review of the
    // same commit would resume a finished job's node_modules and call it a clean checkout.
    expect(f.remove).toHaveBeenCalledOnce();
  });

  // Install is the one moment this sandbox is not deny-all. Closing it again on the next line was
  // safe only while a throw in between destroyed the sandbox on the way out; a sandbox that outlives
  // the request would have stayed reachable from the network for every later segment, with the
  // repository's own test suite about to run inside it.
  it("denies the network again even when install throws before it returns", async () => {
    const f = fixture({ installThrows: true }), runner = new VercelSandboxRunner(f.create);
    await expect(runner.runSegment({ runtime: "node24", files: [], install, checks: [test], revision: "base", sandboxName: "buildit-fixed", segment: { stage: "install", index: 0 } })).rejects.toThrow("registry timed out");
    expect(f.calls.filter(call => Array.isArray(call) && call[0] === "network")).toEqual([["network", { allow: ["registry.npmjs.org", "registry.yarnpkg.com", "npm.jsr.io"] }], ["network", "deny-all"]]);
  });

  // The list grows when a mainstream repository genuinely needs a registry, and never otherwise.
  // Install is the one moment the sandbox is not deny-all, so anything on this list is a host a
  // postinstall script can also reach.
  it("opens the network to package registries and nothing else", () => {
    const source = readFileSync(new URL("../src/vercelSandbox.ts", import.meta.url), "utf8");
    const listed = source.match(/const registryDomains = \[([^\]]*)\]/)?.[1] ?? "";
    const policy = { allow: [...listed.matchAll(/"([^"]+)"/g)].map(match => match[1]!) };
    expect(policy.allow.length).toBeGreaterThan(0);
    for (const host of policy.allow) {
      expect(host, `${host} is not a package registry`).toMatch(/^(?:registry\.|npm\.)[a-z0-9.-]+$/);
    }
    expect(policy.allow).not.toContain("*");
  });

  it("reports a command killed at its ceiling as a timeout, not as a failure", async () => {
    // SIGKILL on timeoutMs surfaces as a plain non-zero exit with no flag, which is exactly what a
    // genuine test failure looks like. Telling them apart is the difference between saying the
    // author's tests are broken and saying BuildIT ran out of time - and the second is the truth
    // on any repository whose suite outlives the 30-second budget.
    const f = fixture({ testExits: [137], testDurationMs: test.timeoutMs }), runner = new VercelSandboxRunner(f.create);
    const result = await review(runner, { runtime: "node22", files: [{ path: "package.json", content: "{}" }, { path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: [test] });
    expect(result.results.find(item => item.planId === "test")).toMatchObject({ conclusion: "timed_out", failureClass: "timeout" });
  });

  it("still calls a genuine non-zero exit a failure", async () => {
    const f = fixture({ testExits: [1], testDurationMs: 900 }), runner = new VercelSandboxRunner(f.create);
    const result = await review(runner, { runtime: "node22", files: [{ path: "package.json", content: "{}" }, { path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: [test] });
    expect(result.results.find(item => item.planId === "test")).toMatchObject({ conclusion: "failed", failureClass: "code" });
  });

  it("reports an install killed at its ceiling as a timeout too", async () => {
    // An install that overruns short-circuits every check, so calling it a failure tells the
    // author their dependencies are broken when nothing was ever installed.
    const f = fixture({ installExit: 137, installDurationMs: install.timeoutMs }), runner = new VercelSandboxRunner(f.create);
    const result = await review(runner, { runtime: "node22", files: [{ path: "package.json", content: "{}" }, { path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: [test] });
    expect(result.results.find(item => item.planId === "install")).toMatchObject({ conclusion: "timed_out", failureClass: "timeout" });
  });

  it("starts both read-only scanners before either scanner is allowed to finish", async () => {
    const f = fixture(), original = f.sandbox.runCommand, started: string[] = [];
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.sandbox.runCommand = vi.fn(async command => {
      if (["gitleaks", "osv-scanner"].includes(command.cmd)) {
        started.push(command.cmd);
        if (started.length === 2) release();
        await gate;
      }
      return original(command);
    });
    await review(new VercelSandboxRunner(f.create), { runtime: "node24", files: [{ path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: [test] });
    expect(started).toEqual(["gitleaks", "osv-scanner"]);
  });

  // The secret scan reads the tree exactly as it arrived. It used to be guaranteed by running
  // before install in the same call; once each stage became its own invocation the declared stage
  // order became the running order, and `scanners` after `checks` would have had gitleaks reading a
  // dependency's test fixtures and whatever the repository's own suite wrote.
  it("scans before anything is installed into the tree", async () => {
    const f = fixture(), runner = new VercelSandboxRunner(f.create);
    await review(runner, { runtime: "node24", files: [{ path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: [test] });
    const order = commands(f.calls).map(call => call[1].cmd === "pnpm" ? call[1].args![0]! : call[1].cmd!);
    expect(order.indexOf("gitleaks")).toBeLessThan(order.indexOf("install"));
    expect(order.indexOf("osv-scanner")).toBeLessThan(order.indexOf("install"));
  });

  it("stops before install when a secret-like environment name is reachable", async () => {
    const f = fixture({ env: "CI=true\nGITHUB_TOKEN=reachable\n" });
    await expect(review(new VercelSandboxRunner(f.create), { runtime: "node24", files: [{ path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: [test] })).rejects.toThrow("credential_teardown_failed");
    expect(f.calls.some(call => Array.isArray(call) && call[0] === "network")).toBe(false);
    // Nothing after prepare will run, so this sandbox has no later owner - and one that failed
    // because a credential was reachable inside it is the last thing to leave alive for a sweeper.
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it("allows the runtime's public AWS certificate bundle path", async () => {
    const f = fixture({ env: "CI=true\nAWS_CA_BUNDLE=/etc/pki/tls/certs/ca-bundle.crt\n" });
    await expect(review(new VercelSandboxRunner(f.create), { runtime: "node24", files: [{ path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: [test] })).resolves.toMatchObject({ credentialTeardownProved: true, stopped: true });
  });

  it("never runs checks after install failure and always releases the sandbox", async () => {
    const f = fixture({ installExit: 1 });
    const result = await review(new VercelSandboxRunner(f.create), { runtime: "node24", files: [{ path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: [test] });
    expect(result.results.map(item => [item.planId, item.conclusion])).toEqual([["install", "failed"], ["test", "not_run"]]);
    expect(commands(f.calls)).toHaveLength(4);
    expect(f.remove).toHaveBeenCalledOnce();
  });

  it("reruns a failed required check inside the same sandbox and stops once it proves flakiness", async () => {
    const f = fixture({ testExits: [1, 0] });
    const result = await review(new VercelSandboxRunner(f.create), { runtime: "node24", files: [{ path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: [test] });
    const names = new Set(f.create.mock.calls.map(call => call[0]!.name));
    expect(names.size).toBe(1);
    expect(commands(f.calls).filter(call => call[1].args?.[1] === "test")).toHaveLength(2);
    expect(result.diagnostics.test).toHaveLength(2);
  });

  it("rejects unsafe file paths and network-enabled checks", async () => {
    const f = fixture(), runner = new VercelSandboxRunner(f.create);
    await expect(review(runner, { runtime: "node22", files: [{ path: "../escape", content: "x" }], install, checks: [test] })).rejects.toThrow("sandbox_unsafe_path");
    await expect(review(runner, { runtime: "node22", files: [], install, checks: [{ ...test, network: "registry_only" }] })).rejects.toThrow("sandbox_check_network_must_be_denied");
    // Refused before a sandbox exists. While one call did the whole review a rejected path cost only
    // the sandbox it was about to use anyway; now the sandbox outlives the request, and one created
    // purely to be refused is an orphan nobody is coming back for.
    expect(f.create).not.toHaveBeenCalled();
  });

  it("accepts only a digest-pinned custom image", async () => {
    const f = fixture(), runner = new VercelSandboxRunner(f.create);
    await expect(review(runner, { runtime: "node24", image: "runner:latest", files: [], install, checks: [test] })).rejects.toThrow("sandbox_image_must_be_digest_pinned");
    const image = `buildit-runner@sha256:${"a".repeat(64)}`;
    await review(runner, { runtime: "node24", image, files: [{ path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: [test] });
    expect(f.create.mock.calls[0]![0]).toMatchObject({ image });
    expect(f.create.mock.calls[0]![0]).not.toHaveProperty("runtime");
  });

  it("passes short-lived control-plane credentials to the sandbox API without placing them in sandbox env", async () => {
    const f = fixture(), runner = new VercelSandboxRunner(f.create);
    await review(runner, { runtime: "node24", credentials: { token: "test-oidc-token", teamId: "team-test", projectId: "project-test" }, files: [{ path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: [test] });
    const create = f.create.mock.calls[0]?.[0];
    expect(create).toMatchObject({ token: "test-oidc-token", teamId: "team-test", projectId: "project-test", env: { CI: "true" } });
    expect(JSON.stringify(create)).not.toContain("VERCEL_OIDC_TOKEN");
  });

  it("rejects repository-owned package-manager hooks and credential configuration", async () => {
    for (const path of [".git/config", ".npmrc", ".yarnrc.yml", ".yarn/plugins/attack.cjs", ".pnpmfile.cjs", ".gitleaks.toml", ".gitleaksignore", ".osv-scanner.toml", "osv-scanner.json"]) {
      const f = fixture();
      await expect(review(new VercelSandboxRunner(f.create), { runtime: "node22", files: [{ path, content: "attack" }], install, checks: [test] })).rejects.toThrow("sandbox_untrusted_install_control");
      expect(f.create).not.toHaveBeenCalled();
    }
  });

  // A root lockfile larger than maxFileBytes is dropped by repository-content before selection can
  // force it back in, so "this repository has no manifests" and "this repository's manifest never
  // arrived" reach the runner identically. Calling the first an empty scan published
  // `| osv-scanner | Required | Passed |` under "Ready for human review" for repositories whose
  // dependencies were never read. The runner cannot tell the two apart, and does not have to: it
  // obtained no dependency scan either way, and that is the honest row.
  it("reports the dependency audit as unavailable when no manifest reached the sandbox", async () => {
    const f = fixture();
    const result = await review(new VercelSandboxRunner(f.create), { runtime: "node24", files: [{ path: "package.json", content: "{}" }], install, checks: [test] });
    expect(result.osvReport).toBe('{"results":[]}');
    expect(result.unavailableScanners).toEqual(["osvScanner"]);
    expect(result.unavailableReason).toContain("no dependency manifest");
    expect(f.remove).toHaveBeenCalledOnce();
  });

  // The argv bound stays; calling what it left out a clean audit does not. All 33 are force-selected
  // into the snapshot, so a vulnerability declared in the 33rd was passing review unseen.
  it("reports the dependency audit as unavailable when there are more manifests than one scan takes", async () => {
    const f = fixture(), files = Array.from({ length: 33 }, (_, index) => ({ path: `services/s${index}/requirements.txt`, content: "flask==1.0" }));
    const result = await review(new VercelSandboxRunner(f.create), { runtime: "node24", files, install, checks: [test] });
    const osv = commands(f.calls).find(call => call[1].cmd === "osv-scanner");
    expect(osv?.[1].args?.filter(arg => arg === "--lockfile")).toHaveLength(32);
    expect(result.unavailableScanners).toEqual(["osvScanner"]);
    expect(result.unavailableReason).toContain("33 manifests");
  });

  it("records a complete empty dependency scan for a valid lockfile with no packages", async () => {
    const f = fixture({ osvExit: 128, osvOutput: "No package sources found, --help for usage information." });
    const result = await review(new VercelSandboxRunner(f.create), { runtime: "node24", files: [{ path: "package-lock.json", content: '{"lockfileVersion":3,"packages":{"":{}}}' }], install, checks: [test] });
    expect(result.osvReport).toBe('{"results":[]}');
    // The manifest was here and was read: an empty result from a lockfile that declares nothing is
    // a scan that happened, and stays a pass.
    expect(result.unavailableScanners).toBeUndefined();
    expect(f.remove).toHaveBeenCalledOnce();
  });
});

// gitleaks was the one scanner that could still take the whole review with it. The osv-scanner path
// beside it degrades to an advisory not-configured row; a gitleaks SIGKILL at
// SANDBOX_SCANNER_TIMEOUT_MS, or a renamed binary after an image bump, threw - the broker answered
// 503 scanner_unavailable, classifyPlatformFailure matched nothing, and the author was told to
// retry a condition that is deterministic per repository. Every retry lost the review identically.
describe("a secret scan that could not run", () => {
  const plans = defaultExecutionPlans("pnpm"), install = plans.install, test = plans.checks[0]!;
  const files = [{ path: "package.json", content: "{}" }, { path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }];

  it("degrades to an unavailable scanner instead of losing the review", async () => {
    const f = fixture({ gitleaksExit: 137 }), runner = new VercelSandboxRunner(f.create);
    const result = await review(runner, { runtime: "node24", files, install, checks: [test] });
    expect(result.unavailableScanners).toEqual(["gitleaks"]);
    expect(result.unavailableReason).toContain("gitleaks exit 137");
    // The code review still ships: the repository's own test ran and its result is reported.
    expect(result.results.find(item => item.planId === "test")).toMatchObject({ conclusion: "passed" });
    // An empty findings list the report will not read as a clean secret scan, because of the row above.
    expect(result.gitleaksReport).toBe("[]");
  });

  it("degrades the same way when the report is unreadable or too large", async () => {
    for (const options of [{ gitleaksReportMissing: true }, { gitleaksReportBytes: 2_000_001 }]) {
      const f = fixture(options), result = await review(new VercelSandboxRunner(f.create), { runtime: "node24", files, install, checks: [test] });
      expect(result.unavailableScanners).toEqual(["gitleaks"]);
      expect(result.gitleaksReport).toBe("[]");
    }
  });

  it("still reports a gitleaks that did run as a scan that happened", async () => {
    const f = fixture(), result = await review(new VercelSandboxRunner(f.create), { runtime: "node24", files, install, checks: [test] });
    expect(result.unavailableScanners).toBeUndefined();
  });
});

// The duration half of the timeout test falls open toward blaming the author: an out-of-memory kill
// of a heavy suite, or a kill the SDK reports with no durationMs at all, was published as a red
// "Changes need review" saying the author's tests are broken, evidenced by a truncated kill.
describe("a check the operating system killed", () => {
  const plans = defaultExecutionPlans("pnpm"), install = plans.install, test = plans.checks[0]!;
  const files = [{ path: "package.json", content: "{}" }, { path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }];

  it("is not attributed to the code under review when the duration denies a timeout", async () => {
    const f = fixture({ testExits: [137, 137], testDurationMs: 900 }), runner = new VercelSandboxRunner(f.create);
    const result = await review(runner, { runtime: "node24", files, install, checks: [test] });
    expect(result.results.find(item => item.planId === "test")).toMatchObject({ conclusion: "not_run", failureClass: "resource_limit" });
  });

  it("is not attributed to it when the SDK reports no duration at all", async () => {
    const f = fixture({ testExits: [137, 137], omitTestDuration: true }), runner = new VercelSandboxRunner(f.create);
    const result = await review(runner, { runtime: "node24", files, install, checks: [test] });
    expect(result.results.find(item => item.planId === "test")).toMatchObject({ conclusion: "not_run", failureClass: "resource_limit" });
  });

  it("treats a killed install the same way, so no check is blamed on missing dependencies", async () => {
    const f = fixture({ installExit: 137, installDurationMs: 900 }), runner = new VercelSandboxRunner(f.create);
    const result = await review(runner, { runtime: "node24", files, install, checks: [test] });
    expect(result.results.find(item => item.planId === "install")).toMatchObject({ conclusion: "not_run", failureClass: "resource_limit" });
  });
});

// An install that overran on one revision but not the other truncated that revision's plan list,
// and pairExecutionEvidence then threw paired_execution_incomplete - the review died as a platform
// error for a reason that was not a timeout and that no report ever explained.
describe("an install failure leaves both revisions the same shape", () => {
  const plans = defaultExecutionPlans("pnpm");
  it("records the checks that never ran instead of dropping them", async () => {
    const f = fixture({ installExit: 1 }), runner = new VercelSandboxRunner(f.create);
    const result = await review(runner, { runtime: "node22", files: [{ path: "package.json", content: "{}" }, { path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install: plans.install, checks: plans.checks });
    expect(result.results.map(item => [item.planId, item.conclusion]))
      .toEqual([["install", "failed"], ["test", "not_run"], ["lint", "not_run"], ["typecheck", "not_run"]]);
    // Still no check actually executed - the rows are a record, not a claim that they ran.
    expect(commands(f.calls).filter(call => call[1].args?.[0] === "run")).toHaveLength(0);
    // And the review still reaches its terminal segment, which is the only place the sandbox is
    // released: a plan that stopped walking stages here would leave two of them running.
    expect(result.segments.map(segment => segment.stage)).toEqual(["prepare", "scanners", "install", "compare"]);
    expect(f.remove).toHaveBeenCalledOnce();
  });
});

// buildit-review-komi#1 is a Kotlin Multiplatform app. It has no Node lockfile, so the runner threw
// osv_lockfile_required, the broker mapped that to scanner_unavailable, and the review died as a
// platform error. That rule meant BuildIT could only review Node repositories - every Go, Rust,
// Python, Java or Kotlin repository failed the same way, with a message about a scanner outage.
describe("dependency scanning outside Node", () => {
  const plans = defaultExecutionPlans("pnpm"), install = plans.install, test = plans.checks[0]!;

  it("reviews a repository that has no dependency manifest at all", async () => {
    const f = fixture(), runner = new VercelSandboxRunner(f.create);
    const result = await review(runner, { runtime: "node22", files: [{ path: "src/Main.kt", content: "fun main() {}" }], install, checks: [test] });
    // Nothing to scan is not a scanner failure and must not end the review - but it is not a clean
    // dependency scan either, so the audit lands as an advisory row rather than a required pass.
    expect(result.osvReport).toBe('{"results":[]}');
    expect(result.gitleaksReport).toBe("[]");
    expect(result.unavailableScanners).toEqual(["osvScanner"]);
    expect(result.results.find(item => item.planId === "test")).toMatchObject({ conclusion: "passed" });
  });

  it("scans a lockfile from an ecosystem osv-scanner supports", async () => {
    const f = fixture(), runner = new VercelSandboxRunner(f.create);
    await review(runner, { runtime: "node22", files: [{ path: "go.mod", content: "module x" }], install, checks: [test] });
    const osv = commands(f.calls).find(call => call[1].cmd === "osv-scanner");
    expect(String(osv?.[1].args?.join(" "))).toContain("go.mod");
  });
});


describe("scanner diagnostics never log repository content", () => {
  const plans = defaultExecutionPlans("pnpm"), install = plans.install, test = plans.checks[0]!;
  const files = [{ path: "private/requirements.txt", content: "internal-package==1.0" }];
  it("logs only a safe category and exit code when OSV prints source and a secret", async () => {
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const f = fixture({ osvExit: 2, osvOutput: "private/payroll.py: salary = confidential_source_fixture", osvStderr: "OPENAI_API_KEY=synthetic_secret_fixture" });
      const result = await review(new VercelSandboxRunner(f.create), { runtime: "node24", files, install, checks: [test] });
      const captured = JSON.stringify([warnings.mock.calls, logs.mock.calls, errors.mock.calls]);
      for (const forbidden of ["private/payroll.py", "confidential_source_fixture", "synthetic_secret_fixture", "OPENAI_API_KEY"]) expect(captured).not.toContain(forbidden);
      expect(warnings).toHaveBeenCalledWith("buildit_osv_unavailable", { reason: "unexpected_exit", exitCode: 2 });
      expect(result.unavailableScanners).toEqual(["osvScanner"]);
      expect(result.unavailableReason).toContain("osv-scanner exit 2");
      expect(result.results.find(row => row.planId === "test")?.conclusion).toBe("passed");
      expect(f.remove).toHaveBeenCalledOnce();
    } finally { warnings.mockRestore(); logs.mockRestore(); errors.mockRestore(); }
  });
  it.each([
    [{ gitleaksExit: 137 }, "unexpected_exit", 137],
    [{ gitleaksReportMissing: true }, "report_missing", 0],
    [{ gitleaksReportBytes: 2_000_001 }, "report_too_large", 0],
  ] as const)("keeps gitleaks diagnostic categories closed for %o", async (options, reason, exitCode) => {
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const f = fixture({ ...options, gitleaksOutput: "private-source synthetic_secret_fixture" });
      const result = await review(new VercelSandboxRunner(f.create), { runtime: "node24", files, install, checks: [test] });
      expect(warnings).toHaveBeenCalledWith("buildit_gitleaks_unavailable", { reason, exitCode });
      expect(JSON.stringify(warnings.mock.calls)).not.toContain("synthetic_secret_fixture");
      expect(result.unavailableScanners).toEqual(["gitleaks"]);
      expect(result.results.find(row => row.planId === "test")?.conclusion).toBe("passed");
    } finally { warnings.mockRestore(); }
  });
});
