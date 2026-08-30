import { describe, expect, it, vi } from "vitest";
import { createNamedPlan } from "../src/index";
import { VercelSandboxRunner, type SandboxFactory, type SandboxLike } from "../src/vercelSandbox";

function fixture(options: { env?: string; installExit?: number } = {}) {
  const calls: Array<unknown> = [], stop = vi.fn(async () => ({}));
  const sandbox: SandboxLike = {
    writeFiles: vi.fn(async files => { calls.push(["files", files]); }),
    updateNetworkPolicy: vi.fn(async policy => { calls.push(["network", policy]); }),
    runCommand: vi.fn(async command => {
      calls.push(["command", command]);
      const isEnv = command.cmd === "env", exitCode = isEnv ? 0 : command.cmd === "pnpm" && command.args[0] === "install" ? options.installExit ?? 0 : 0;
      return { exitCode, durationMs: 10, stdout: async () => isEnv ? options.env ?? "CI=true\n" : "ok", stderr: async () => "" };
    }),
    stop,
  };
  return { sandbox, calls, stop, create: vi.fn(async (_input: Parameters<SandboxFactory>[0]) => sandbox) };
}

describe("Vercel sandbox runner", () => {
  const install = createNamedPlan({ planId: "install", manager: "pnpm", origin: "built_in", required: true });
  const test = createNamedPlan({ planId: "test", manager: "pnpm", origin: "built_in", required: true });

  it("writes fetched files without a GitHub token, permits only install registries, then denies all network", async () => {
    const f = fixture(), runner = new VercelSandboxRunner(f.create);
    const result = await runner.run({ runtime: "node22", files: [{ path: "package.json", content: "{}" }], install, checks: [test] });
    expect(result.credentialTeardownProved).toBe(true);
    expect(f.calls).toContainEqual(["network", { allow: ["registry.npmjs.org", "registry.yarnpkg.com"] }]);
    expect(f.calls).toContainEqual(["network", "deny-all"]);
    expect(f.calls).toContainEqual(["command", { cmd: "pnpm", args: ["install", "--frozen-lockfile", "--ignore-scripts"], cwd: "/vercel/sandbox/repo", timeoutMs: 600_000 }]);
    expect(f.create.mock.calls[0]![0]).toMatchObject({ networkPolicy: "deny-all", env: { CI: "true" }, region: "cdg1", persistent: false });
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it("stops before install when a secret-like environment name is reachable", async () => {
    const f = fixture({ env: "CI=true\nGITHUB_TOKEN=reachable\n" });
    await expect(new VercelSandboxRunner(f.create).run({ runtime: "node24", files: [], install, checks: [test] })).rejects.toThrow("credential_teardown_failed");
    expect(f.calls.some(call => Array.isArray(call) && call[0] === "network")).toBe(false);
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it("allows the runtime's public AWS certificate bundle path", async () => {
    const f = fixture({ env: "CI=true\nAWS_CA_BUNDLE=/etc/pki/tls/certs/ca-bundle.crt\n" });
    await expect(new VercelSandboxRunner(f.create).run({ runtime: "node24", files: [], install, checks: [test] })).resolves.toMatchObject({ credentialTeardownProved: true, stopped: true });
  });

  it("never runs checks after install failure and always stops", async () => {
    const f = fixture({ installExit: 1 });
    const result = await new VercelSandboxRunner(f.create).run({ runtime: "node24", files: [], install, checks: [test] });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.conclusion).toBe("failed");
    expect(f.calls.filter(call => Array.isArray(call) && call[0] === "command")).toHaveLength(2);
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it("rejects unsafe file paths and network-enabled checks", async () => {
    const f = fixture(), runner = new VercelSandboxRunner(f.create);
    await expect(runner.run({ runtime: "node22", files: [{ path: "../escape", content: "x" }], install, checks: [test] })).rejects.toThrow("sandbox_unsafe_path");
    await expect(runner.run({ runtime: "node22", files: [], install, checks: [{ ...test, network: "registry_only" }] })).rejects.toThrow("sandbox_check_network_must_be_denied");
  });
});
