import { Sandbox } from "@vercel/sandbox";
import { executionReady, type CheckResult, type CommandPlan, type Workspace } from "./index.js";

type Finished = { exitCode: number; durationMs?: number; stdout(): Promise<string>; stderr(): Promise<string> };
type SandboxCommand = { cmd: string; args: string[]; cwd?: string; timeoutMs: number };
export type SandboxLike = {
  writeFiles(files: Array<{ path: string; content: Uint8Array }>): Promise<void>;
  runCommand(command: SandboxCommand): Promise<Finished>;
  updateNetworkPolicy(policy: "deny-all" | { allow: string[] }): Promise<unknown>;
  stop(): Promise<unknown>;
};
export type SandboxFactory = (input: { runtime: "node22" | "node24"; timeout: number; resources: { vcpus: number }; networkPolicy: "deny-all"; env: Record<string, string>; region: string; persistent: false }) => Promise<SandboxLike>;

const registryDomains = ["registry.npmjs.org", "registry.yarnpkg.com"];
const sensitive = /(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|GITHUB_|VERCEL_|CONVEX_|ANTHROPIC_|OPENAI_|GEMINI_|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN)/i;
const unsafeInstallControl = /(^|\/)(?:\.git|\.npmrc|\.yarnrc(?:\.yml)?|\.pnpmfile\.cjs|pnpmfile\.cjs|\.pnp\.(?:cjs|js)|\.yarn\/plugins)(\/|$)/i;

async function output(result: Finished, limit: number) {
  const [stdout, stderr] = await Promise.all([result.stdout(), result.stderr()]);
  const combined = `${stdout}${stderr ? `\n${stderr}` : ""}`;
  return { text: combined.slice(0, limit), truncated: Buffer.byteLength(combined, "utf8") > limit };
}

export class VercelSandboxRunner {
  constructor(private readonly create: SandboxFactory = async input => Sandbox.create(input) as unknown as SandboxLike) {}

  async run(input: {
    runtime: "node22" | "node24";
    files: Array<{ path: string; content: string }>;
    install: CommandPlan;
    checks: CommandPlan[];
  }) {
    if (input.install.planId !== "install" || input.install.network !== "registry_only") throw new Error("sandbox_install_plan_required");
    if (input.checks.some(plan => plan.network !== "none")) throw new Error("sandbox_check_network_must_be_denied");
    const timeout = Math.min(45 * 60_000, input.install.timeoutMs + input.checks.reduce((sum, plan) => sum + plan.timeoutMs, 0) + 60_000);
    const sandbox = await this.create({ runtime: input.runtime, timeout, resources: { vcpus: 2 }, networkPolicy: "deny-all", env: { CI: "true" }, region: "cdg1", persistent: false });
    const results: CheckResult[] = [];
    try {
      const workspace: Workspace = { files: new Map(), environment: { CI: "true" }, tokenRevoked: true };
      if (!executionReady(workspace)) throw new Error("credential_teardown_failed");
      for (const file of input.files) {
        if (!file.path || file.path.startsWith("/") || file.path.split("/").includes("..")) throw new Error("sandbox_unsafe_path");
        if (unsafeInstallControl.test(file.path)) throw new Error("sandbox_untrusted_install_control");
      }
      await sandbox.writeFiles(input.files.map(file => ({ path: `/vercel/sandbox/repo/${file.path}`, content: Buffer.from(file.content) })));
      const environment = await sandbox.runCommand({ cmd: "env", args: [], timeoutMs: 10_000 });
      const environmentText = await environment.stdout();
      if (environmentText.split("\n").some(line => sensitive.test(line.split("=", 1)[0] ?? ""))) throw new Error("credential_teardown_failed");

      await sandbox.updateNetworkPolicy({ allow: registryDomains });
      const installResult = await sandbox.runCommand({ cmd: input.install.executable, args: input.install.args, cwd: "/vercel/sandbox/repo", timeoutMs: input.install.timeoutMs });
      const installOutput = await output(installResult, input.install.outputBytes);
      results.push({ ...input.install, conclusion: installOutput.truncated ? "truncated" : installResult.exitCode === 0 ? "passed" : "failed", exitCode: installResult.exitCode, durationMs: installResult.durationMs ?? 0, ...(installResult.exitCode === 0 ? {} : { failureClass: "code" as const }) });
      if (installResult.exitCode !== 0 || installOutput.truncated) return { credentialTeardownProved: true, results, stopped: true };

      await sandbox.updateNetworkPolicy("deny-all");
      for (const plan of input.checks) {
        const result = await sandbox.runCommand({ cmd: plan.executable, args: plan.args, cwd: "/vercel/sandbox/repo", timeoutMs: plan.timeoutMs });
        const captured = await output(result, plan.outputBytes);
        results.push({ ...plan, conclusion: captured.truncated ? "truncated" : result.exitCode === 0 ? "passed" : "failed", exitCode: result.exitCode, durationMs: result.durationMs ?? 0, ...(result.exitCode === 0 ? {} : { failureClass: "code" as const }) });
      }
      return { credentialTeardownProved: true, results, stopped: true };
    } finally {
      await sandbox.stop();
    }
  }
}
