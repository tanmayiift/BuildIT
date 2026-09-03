import { describe, expect, it, vi } from "vitest";
import { defaultExecutionPlans } from "../src/index";
import { VercelSandboxRunner, type SandboxFactory, type SandboxLike } from "../src/vercelSandbox";

function fixture(options: { env?: string; installExit?: number; testExits?: number[]; osvExit?: number; osvOutput?: string; testDurationMs?: number; installDurationMs?: number } = {}) {
  const calls: Array<unknown> = [], stop = vi.fn(async () => ({}));
  const sandbox: SandboxLike = {
    writeFiles: vi.fn(async files => { calls.push(["files", files]); }),
    readFileToBuffer: vi.fn(async file => Buffer.from(file.path.includes("osv") ? '{"results":[]}' : "[]")),
    updateNetworkPolicy: vi.fn(async policy => { calls.push(["network", policy]); }),
    runCommand: vi.fn(async command => {
      calls.push(["command", command]);
      const isEnv = command.cmd === "env", isOsv = command.cmd === "osv-scanner", isTest = command.cmd === "pnpm" && command.args[0] === "run" && command.args[1] === "test", exitCode = isEnv ? 0 : isOsv ? options.osvExit ?? 0 : command.cmd === "pnpm" && command.args[0] === "install" ? options.installExit ?? 0 : isTest ? options.testExits?.shift() ?? 0 : 0;
      const durationMs = isTest ? options.testDurationMs ?? 10 : command.cmd === "pnpm" && command.args[0] === "install" ? options.installDurationMs ?? 10 : 10;
      return { exitCode, durationMs, stdout: async () => isEnv ? options.env ?? "CI=true\n" : isOsv ? options.osvOutput ?? "ok" : "ok", stderr: async () => "" };
    }),
    stop,
  };
  return { sandbox, calls, stop, create: vi.fn(async (_input: Parameters<SandboxFactory>[0]) => sandbox) };
}

describe("Vercel sandbox runner", () => {
  const plans = defaultExecutionPlans("pnpm"), install = plans.install, test = plans.checks[0]!;

  it("writes fetched files without a GitHub token, permits only install registries, then denies all network", async () => {
    const f = fixture(), runner = new VercelSandboxRunner(f.create);
    const result = await runner.run({ runtime: "node22", files: [{ path: "package.json", content: "{}" }, { path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: [test] });
    expect(result.credentialTeardownProved).toBe(true);
    expect(result.gitleaksReport).toBe("[]");
    expect(result.osvReport).toBe('{"results":[]}');
    expect(result.outputs).toEqual([{ planId: "install", text: "ok", truncated: false }, { planId: "test", text: "ok", truncated: false }]);
    expect(f.calls).toContainEqual(["network", { allow: ["registry.npmjs.org", "registry.yarnpkg.com"] }]);
    expect(f.calls).toContainEqual(["network", "deny-all"]);
    expect(f.calls).toContainEqual(["command", { cmd: "pnpm", args: ["install", "--frozen-lockfile", "--ignore-scripts"], cwd: "/vercel/sandbox/repo", timeoutMs: 150_000 }]);
    expect(f.calls).toContainEqual(["command", { cmd: "osv-scanner", args: ["scan", "source", "--offline", "--no-resolve", "--format", "json", "--output", "/tmp/buildit-osv.json", "--lockfile", "/vercel/sandbox/repo/pnpm-lock.yaml"], cwd: "/vercel/sandbox/repo", timeoutMs: 50_000 }]);
    expect(f.create.mock.calls[0]![0]).toMatchObject({ timeout: 580_000, networkPolicy: "deny-all", env: { CI: "true" }, region: "cdg1", persistent: false });
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it("reports a command killed at its ceiling as a timeout, not as a failure", async () => {
    // SIGKILL on timeoutMs surfaces as a plain non-zero exit with no flag, which is exactly what a
    // genuine test failure looks like. Telling them apart is the difference between saying the
    // author's tests are broken and saying BuildIT ran out of time - and the second is the truth
    // on any repository whose suite outlives the 30-second budget.
    const f = fixture({ testExits: [137], testDurationMs: test.timeoutMs }), runner = new VercelSandboxRunner(f.create);
    const result = await runner.run({ runtime: "node22", files: [{ path: "package.json", content: "{}" }, { path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: [test] });
    expect(result.results.find(item => item.planId === "test")).toMatchObject({ conclusion: "timed_out", failureClass: "timeout" });
  });

  it("still calls a genuine non-zero exit a failure", async () => {
    const f = fixture({ testExits: [1], testDurationMs: 900 }), runner = new VercelSandboxRunner(f.create);
    const result = await runner.run({ runtime: "node22", files: [{ path: "package.json", content: "{}" }, { path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: [test] });
    expect(result.results.find(item => item.planId === "test")).toMatchObject({ conclusion: "failed", failureClass: "code" });
  });

  it("reports an install killed at its ceiling as a timeout too", async () => {
    // An install that overruns short-circuits every check, so calling it a failure tells the
    // author their dependencies are broken when nothing was ever installed.
    const f = fixture({ installExit: 137, installDurationMs: install.timeoutMs }), runner = new VercelSandboxRunner(f.create);
    const result = await runner.run({ runtime: "node22", files: [{ path: "package.json", content: "{}" }, { path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: [test] });
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
    await new VercelSandboxRunner(f.create).run({ runtime: "node24", files: [{ path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: [test] });
    expect(started).toEqual(["gitleaks", "osv-scanner"]);
  });

  it("stops before install when a secret-like environment name is reachable", async () => {
    const f = fixture({ env: "CI=true\nGITHUB_TOKEN=reachable\n" });
    await expect(new VercelSandboxRunner(f.create).run({ runtime: "node24", files: [{ path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: [test] })).rejects.toThrow("credential_teardown_failed");
    expect(f.calls.some(call => Array.isArray(call) && call[0] === "network")).toBe(false);
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it("allows the runtime's public AWS certificate bundle path", async () => {
    const f = fixture({ env: "CI=true\nAWS_CA_BUNDLE=/etc/pki/tls/certs/ca-bundle.crt\n" });
    await expect(new VercelSandboxRunner(f.create).run({ runtime: "node24", files: [{ path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: [test] })).resolves.toMatchObject({ credentialTeardownProved: true, stopped: true });
  });

  it("never runs checks after install failure and always stops", async () => {
    const f = fixture({ installExit: 1 });
    const result = await new VercelSandboxRunner(f.create).run({ runtime: "node24", files: [{ path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: [test] });
    expect(result.results.map(item => [item.planId, item.conclusion])).toEqual([["install", "failed"], ["test", "not_run"]]);
    expect(f.calls.filter(call => Array.isArray(call) && call[0] === "command")).toHaveLength(4);
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it("reruns a failed required check inside the same sandbox and stops once it proves flakiness", async () => {
    const f = fixture({ testExits: [1, 0] });
    const result = await new VercelSandboxRunner(f.create).run({ runtime: "node24", files: [{ path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: [test] });
    expect(f.create).toHaveBeenCalledOnce();
    expect(f.calls.filter(call => Array.isArray(call) && call[0] === "command" && (call[1] as { args?: string[] }).args?.[1] === "test")).toHaveLength(2);
    expect(result.diagnostics.test).toHaveLength(2);
  });

  it("rejects unsafe file paths and network-enabled checks", async () => {
    const f = fixture(), runner = new VercelSandboxRunner(f.create);
    await expect(runner.run({ runtime: "node22", files: [{ path: "../escape", content: "x" }], install, checks: [test] })).rejects.toThrow("sandbox_unsafe_path");
    await expect(runner.run({ runtime: "node22", files: [], install, checks: [{ ...test, network: "registry_only" }] })).rejects.toThrow("sandbox_check_network_must_be_denied");
  });

  it("accepts only a digest-pinned custom image", async () => {
    const f = fixture(), runner = new VercelSandboxRunner(f.create);
    await expect(runner.run({ runtime: "node24", image: "runner:latest", files: [], install, checks: [test] })).rejects.toThrow("sandbox_image_must_be_digest_pinned");
    const image = `buildit-runner@sha256:${"a".repeat(64)}`;
    await runner.run({ runtime: "node24", image, files: [{ path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: [test] });
    expect(f.create.mock.calls[0]![0]).toMatchObject({ image });
    expect(f.create.mock.calls[0]![0]).not.toHaveProperty("runtime");
  });

  it("passes short-lived control-plane credentials to the sandbox API without placing them in sandbox env", async () => {
    const f = fixture(), runner = new VercelSandboxRunner(f.create);
    await runner.run({ runtime: "node24", credentials: { token: "test-oidc-token", teamId: "team-test", projectId: "project-test" }, files: [{ path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install, checks: [test] });
    const create = f.create.mock.calls[0]?.[0];
    expect(create).toMatchObject({ token: "test-oidc-token", teamId: "team-test", projectId: "project-test", env: { CI: "true" } });
    expect(JSON.stringify(create)).not.toContain("VERCEL_OIDC_TOKEN");
  });

  it("rejects repository-owned package-manager hooks and credential configuration", async () => {
    for (const path of [".git/config", ".npmrc", ".yarnrc.yml", ".yarn/plugins/attack.cjs", ".pnpmfile.cjs", ".gitleaks.toml", ".gitleaksignore", ".osv-scanner.toml", "osv-scanner.json"]) {
      const f = fixture();
      await expect(new VercelSandboxRunner(f.create).run({ runtime: "node22", files: [{ path, content: "attack" }], install, checks: [test] })).rejects.toThrow("sandbox_untrusted_install_control");
      expect(f.stop).toHaveBeenCalledOnce();
    }
  });

  it("fails closed without a supported Node lockfile", async () => {
    const f = fixture();
    await expect(new VercelSandboxRunner(f.create).run({ runtime: "node24", files: [{ path: "package.json", content: "{}" }], install, checks: [test] })).rejects.toThrow("osv_lockfile_required");
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it("records a complete empty dependency scan for a valid lockfile with no packages", async () => {
    const f = fixture({ osvExit: 128, osvOutput: "No package sources found, --help for usage information." });
    const result = await new VercelSandboxRunner(f.create).run({ runtime: "node24", files: [{ path: "package-lock.json", content: '{"lockfileVersion":3,"packages":{"":{}}}' }], install, checks: [test] });
    expect(result.osvReport).toBe('{"results":[]}');
    expect(f.stop).toHaveBeenCalledOnce();
  });
});

// An install that overran on one revision but not the other truncated that revision's plan list,
// and pairExecutionEvidence then threw paired_execution_incomplete - the review died as a platform
// error for a reason that was not a timeout and that no report ever explained.
describe("an install failure leaves both revisions the same shape", () => {
  const plans = defaultExecutionPlans("pnpm");
  it("records the checks that never ran instead of dropping them", async () => {
    const f = fixture({ installExit: 1 }), runner = new VercelSandboxRunner(f.create);
    const result = await runner.run({ runtime: "node22", files: [{ path: "package.json", content: "{}" }, { path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" }], install: plans.install!, checks: plans.checks });
    expect(result.results.map(item => [item.planId, item.conclusion]))
      .toEqual([["install", "failed"], ["test", "not_run"], ["lint", "not_run"], ["typecheck", "not_run"]]);
    // Still no check actually executed - the rows are a record, not a claim that they ran.
    expect(f.calls.filter(call => Array.isArray(call) && call[0] === "command"
      && (call[1] as { args?: string[] }).args?.[0] === "run")).toHaveLength(0);
  });
});
