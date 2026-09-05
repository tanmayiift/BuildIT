import { createHash } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import { type CheckResult, classifyCheckConclusion, type CommandPlan, diagnoseFlakiness, type DiagnosticRun, executionReady, SANDBOX_DIAGNOSTIC_RERUN_LIMIT, SANDBOX_OVERHEAD_RESERVE_MS, SANDBOX_SCANNER_TIMEOUT_MS, SERVERLESS_SANDBOX_WORK_BUDGET_MS, type Workspace } from "./index.js";

type Finished = { exitCode: number; durationMs?: number; stdout(): Promise<string>; stderr(): Promise<string> };
type SandboxCommand = { cmd: string; args: string[]; cwd?: string; timeoutMs: number };
export type SandboxLike = {
  writeFiles(files: Array<{ path: string; content: Uint8Array }>): Promise<void>;
  readFileToBuffer(file: { path: string; cwd?: string }): Promise<Buffer | null>;
  runCommand(command: SandboxCommand): Promise<Finished>;
  updateNetworkPolicy(policy: "deny-all" | { allow: string[] }): Promise<unknown>;
  stop(): Promise<unknown>;
};
export type SandboxCredentials = { token: string; teamId: string; projectId: string };
export type SandboxFactory = (input: { runtime?: "node22" | "node24"; image?: string; timeout: number; resources: { vcpus: number }; networkPolicy: "deny-all"; env: Record<string, string>; region: string; persistent: false } & Partial<SandboxCredentials>) => Promise<SandboxLike>;

// The only hosts install may reach, and the reason the sandbox is otherwise deny-all: a postinstall
// script that can talk to anything is a way out of the boundary. Registries only, never a general
// allowance.
//
// npm.jsr.io joined the list after a real review of date-fns ended inconclusive: it depends on a
// JSR-published package, install could not resolve it, and every required check went Not Run. A
// dependency registry a mainstream repository genuinely needs is exactly what this list is for -
// the alternative was telling that repository we could not review it, which is not a security
// posture, just a smaller product.
const registryDomains = ["registry.npmjs.org", "registry.yarnpkg.com", "npm.jsr.io"];
const sensitive = /(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|GITHUB_|VERCEL_|CONVEX_|ANTHROPIC_|OPENAI_|GEMINI_|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN)/i;
const unsafeInstallControl = /(^|\/)(?:\.git|\.npmrc|\.yarnrc(?:\.yml)?|\.pnpmfile\.cjs|pnpmfile\.cjs|\.pnp\.(?:cjs|js)|\.yarn\/plugins|\.gitleaks\.toml|\.gitleaksignore|\.?osv-scanner\.(?:toml|json))(\/|$)/i;
export function isUnsafeInstallControlPath(path: string) { return unsafeInstallControl.test(path); }
export const dependencyManifest = /(^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock(?:b)?|Cargo\.lock|go\.mod|go\.sum|poetry\.lock|Pipfile\.lock|pdm\.lock|uv\.lock|requirements(?:[-.][\w.-]+)?\.txt|Gemfile\.lock|composer\.lock|mix\.lock|pubspec\.lock|conan\.lock|gradle\.lockfile|buildscript-gradle\.lockfile|packages\.lock\.json|renv\.lock|pom\.xml)$/;

// What the execution plan is derived from, and therefore what BOTH revisions must be able to see.
// detectPackageManager reads these from base and head and refuses the review when the two disagree,
// so a selection rule that keeps a lockfile on head and drops it on base is not a missing file - it
// is a hard platform failure with no review and no checks, on every repository above the selection
// threshold whose pull request happens not to touch its manifests. Which is most of them.
export const executionPlanInput = (path: string) => dependencyManifest.test(path) || path === "package.json";

// The SDK kills a command with SIGKILL when it passes timeoutMs and still resolves with a plain
// non-zero exitCode - there is no timeout flag on CommandFinished. So a 30-second kill and a
// genuine test failure arrive here identical, and every timeout was reported as "failed". That is
// not a label problem: computeReviewDecision routes failed to changes_requested, so BuildIT told
// the author their tests were broken when in truth it ran out of time. What the SDK does give us
// is the duration and SIGKILL's 128+9 exit code, and both must agree before we call it a timeout.
//
// Two adjacent traps this exposed, recorded rather than fixed because both need the sandbox moved
// off the synchronous request path, which the 300s ceiling in packages/broker/vercel.json forces:
// an install that overruns 60s returns early below and no check runs at all, so the report shows
// one install row and nothing else; and a gitleaks SIGKILL at SANDBOX_SCANNER_TIMEOUT_MS throws
// gitleaks_execution_failed, which becomes a 503 and kills the review outright rather than
// degrading it.
const sigkillExit = 137;
function timedOut(exitCode: number | undefined, durationMs: number | undefined, timeoutMs: number) {
  return exitCode === sigkillExit && (durationMs ?? 0) >= timeoutMs;
}

async function output(result: Finished, limit: number) {
  const [stdout, stderr] = await Promise.all([result.stdout(), result.stderr()]);
  const combined = `${stdout}${stderr ? `\n${stderr}` : ""}`;
  return { text: combined.slice(0, limit), truncated: Buffer.byteLength(combined, "utf8") > limit };
}

export class VercelSandboxRunner {
  constructor(private readonly create: SandboxFactory = async input => {
    const { image, runtime, ...environment } = input;
    return Sandbox.create(image ? { ...environment, image } : { ...environment, runtime: runtime ?? "node24" }) as unknown as SandboxLike;
  }) {}

  async run(input: {
    runtime: "node22" | "node24";
    image?: string;
    credentials?: SandboxCredentials;
    files: Array<{ path: string; content: string }>;
    install?: CommandPlan;
    checks: CommandPlan[];
  }) {
    if (input.install && (input.install.planId !== "install" || input.install.network !== "registry_only")) throw new Error("sandbox_install_plan_required");
    if (!input.install && input.checks.length) throw new Error("sandbox_checks_without_install");
    if (input.checks.some(plan => plan.network !== "none")) throw new Error("sandbox_check_network_must_be_denied");
    const planBudget = (input.install?.timeoutMs ?? 0) + input.checks.reduce((sum, plan) => sum + plan.timeoutMs, 0);
    const diagnosticBudget = input.checks.filter(plan => plan.required).reduce((sum, plan) => sum + plan.timeoutMs * SANDBOX_DIAGNOSTIC_RERUN_LIMIT, 0);
    if (planBudget + diagnosticBudget > SERVERLESS_SANDBOX_WORK_BUDGET_MS) throw new Error("sandbox_execution_budget_exceeded");
    const timeout = planBudget + diagnosticBudget + SANDBOX_SCANNER_TIMEOUT_MS + SANDBOX_OVERHEAD_RESERVE_MS;
    if (input.image && !/^(?:[a-z0-9][a-z0-9.\-]*(?::\d+)?\/)?[a-z0-9][a-z0-9._\-\/]*@sha256:[0-9a-f]{64}$/.test(input.image)) throw new Error("sandbox_image_must_be_digest_pinned");
    const environment = { timeout, resources: { vcpus: 2 }, networkPolicy: "deny-all" as const, env: { CI: "true" }, region: "cdg1", persistent: false as const };
    const sandbox = await this.create(input.image ? { ...environment, image: input.image, ...(input.credentials ?? {}) } : { ...environment, runtime: input.runtime, ...(input.credentials ?? {}) });
    const results: CheckResult[] = [], outputs: Array<{ planId: CommandPlan["planId"]; text: string; truncated: boolean }> = [], diagnostics: Partial<Record<CommandPlan["planId"], DiagnosticRun[]>> = {};
    try {
      const workspace: Workspace = { files: new Map(), environment: { CI: "true" }, tokenRevoked: true };
      if (!executionReady(workspace)) throw new Error("credential_teardown_failed");
      for (const file of input.files) {
        if (!file.path || file.path.startsWith("/") || file.path.split("/").includes("..")) throw new Error("sandbox_unsafe_path");
        if (isUnsafeInstallControlPath(file.path)) throw new Error("sandbox_untrusted_install_control");
      }
      const lockfiles = input.files.map(file => file.path).filter(path => dependencyManifest.test(path)).slice(0, 32);
      await sandbox.writeFiles(input.files.map(file => ({ path: `/vercel/sandbox/repo/${file.path}`, content: Buffer.from(file.content) })));
      const environment = await sandbox.runCommand({ cmd: "env", args: [], timeoutMs: 10_000 });
      const environmentText = await environment.stdout();
      if (environmentText.split("\n").some(line => sensitive.test(line.split("=", 1)[0] ?? ""))) throw new Error("credential_teardown_failed");

      const [gitleaks, osv] = await Promise.all([
        sandbox.runCommand({ cmd: "gitleaks", args: ["dir", "--no-banner", "--no-color", "--redact=100", "--exit-code", "0", "--report-format", "json", "--report-path", "/tmp/buildit-gitleaks.json", "--max-target-megabytes", "10", "/vercel/sandbox/repo"], timeoutMs: SANDBOX_SCANNER_TIMEOUT_MS }),
        sandbox.runCommand({ cmd: "osv-scanner", args: ["scan", "source", "--offline", "--no-resolve", "--format", "json", "--output", "/tmp/buildit-osv.json", ...lockfiles.flatMap(path => ["--lockfile", `/vercel/sandbox/repo/${path}`])], cwd: "/vercel/sandbox/repo", timeoutMs: SANDBOX_SCANNER_TIMEOUT_MS }),
      ]);
      if (gitleaks.exitCode !== 0) throw new Error("gitleaks_execution_failed");
      const gitleaksReport = await sandbox.readFileToBuffer({ path: "/tmp/buildit-gitleaks.json" });
      if (!gitleaksReport || gitleaksReport.byteLength > 2_000_000) throw new Error("gitleaks_report_invalid");

      // Keep lockfile paths absolute. The SDK honours cwd, but the scanner itself
      // resolves lockfiles before it changes working directory in some runtimes.
      // An absolute, sandbox-owned path prevents a false scanner failure while
      // preserving the same no-network, read-only scan boundary.
      const osvOutput = await output(osv, 8_192);
      // No manifest means no dependencies to scan. Reported as an empty result so the check is
      // honest about having run and found nothing, rather than claiming the scanner was down.
      // OSV-Scanner exits 128 and writes no report for a valid lockfile with no
      // package sources. That is a complete empty dependency scan, not a scanner
      // outage. Every other non-result remains a hard failure.
      const noPackageSources = !lockfiles.length || (osv.exitCode === 128 && /No package sources found/.test(osvOutput.text));
      // osv-scanner cannot resolve every ecosystem's manifest offline - a Maven pom.xml or a
      // Python pyproject.toml needs a resolver it is deliberately not allowed to reach, because
      // this sandbox has no network at scan time. That is a capability BuildIT does not have for
      // this repository, not an outage and not a clean scan.
      //
      // It used to be neither: any unexpected exit code threw, the broker mapped it to
      // scanner_unavailable, and the whole review died as a platform failure. Two of the first six
      // real repositories reviewed - one Python, one Java - were lost that way, with the sandbox
      // working, the repository's own tests run, and the code read. A dependency scanner that does
      // not speak an ecosystem must not be able to void a code review.
      //
      // Reported as unavailable rather than empty: '{"results":[]}' would claim BuildIT looked at
      // the dependencies and found nothing, which is the one thing it must not say here.
      //
      // Classified on the exit code rather than on the wording of the error. The first attempt at
      // this matched stderr against a guessed vocabulary, missed what osv-scanner actually prints,
      // and both repositories failed again exactly as before - a reminder that a rule keyed on a
      // message nobody has read is a guess wearing a regex.
      //
      // The exit code is enough, because "not configured" is the honest report for every case it
      // covers: whether osv-scanner could not parse the manifest or was genuinely unwell, BuildIT
      // did not obtain a dependency scan, and that is what gets reported. Nothing here can turn
      // into a false pass; the only thing it gives up is telling those two causes apart in the
      // report, and the exit code is recorded so an operator still can.
      const unscannable = ![0, 1].includes(osv.exitCode) && !noPackageSources;
      if (unscannable) console.warn(`buildit_osv_unavailable exit=${osv.exitCode} output=${osvOutput.text.slice(0, 400)}`);
      const osvReport = noPackageSources || unscannable ? Buffer.from('{"results":[]}') : await sandbox.readFileToBuffer({ path: "/tmp/buildit-osv.json" });
      if (!osvReport || osvReport.byteLength > 4_000_000) throw new Error("osv_report_invalid");

      const installPlan = input.install;
      if (!installPlan) return { credentialTeardownProved: true, results, outputs, diagnostics, gitleaksReport: gitleaksReport.toString("utf8"), osvReport: osvReport.toString("utf8"), ...(unscannable ? { unavailableScanners: ["osvScanner" as const], unavailableReason: `osv-scanner exit ${osv.exitCode}` } : {}), stopped: true };

      await sandbox.updateNetworkPolicy({ allow: registryDomains });
      const installResult = await sandbox.runCommand({ cmd: installPlan.executable, args: installPlan.args, cwd: "/vercel/sandbox/repo", timeoutMs: installPlan.timeoutMs });
      const installOutput = await output(installResult, installPlan.outputBytes);
      outputs.push({ planId: installPlan.planId, ...installOutput });
      const installTimedOut = timedOut(installResult.exitCode, installResult.durationMs, installPlan.timeoutMs);
      results.push({ ...installPlan, conclusion: installOutput.truncated ? "truncated" : installResult.exitCode === 0 ? "passed" : installTimedOut ? "timed_out" : "failed", exitCode: installResult.exitCode, durationMs: installResult.durationMs ?? 0, ...(installResult.exitCode === 0 ? {} : { failureClass: installTimedOut ? ("timeout" as const) : ("code" as const) }) });
      diagnostics.install = [{ conclusion: installResult.exitCode === 0 && !installOutput.truncated ? "passed" : "failed", ...(installResult.exitCode === 0 && !installOutput.truncated ? {} : { failureFingerprint: createHash("sha256").update(installOutput.text).digest("hex") }) }];
      if (installResult.exitCode !== 0 || installOutput.truncated) {
        for (const plan of input.checks) results.push({ ...plan, conclusion: "not_run" as const, durationMs: 0, failureClass: "environment" as const });
        return { credentialTeardownProved: true, results, outputs, diagnostics, gitleaksReport: gitleaksReport.toString("utf8"), osvReport: osvReport.toString("utf8"), ...(unscannable ? { unavailableScanners: ["osvScanner" as const], unavailableReason: `osv-scanner exit ${osv.exitCode}` } : {}), stopped: true };
      }

      await sandbox.updateNetworkPolicy("deny-all");
      for (const plan of input.checks) {
        const result = await sandbox.runCommand({ cmd: plan.executable, args: plan.args, cwd: "/vercel/sandbox/repo", timeoutMs: plan.timeoutMs });
        const captured = await output(result, plan.outputBytes);
        outputs.push({ planId: plan.planId, ...captured });
        const checkTimedOut = timedOut(result.exitCode, result.durationMs, plan.timeoutMs);
        results.push({ ...plan, conclusion: captured.truncated ? "truncated" : checkTimedOut ? "timed_out" : classifyCheckConclusion({ exitCode: result.exitCode, output: captured.text }), exitCode: result.exitCode, durationMs: result.durationMs ?? 0, ...(result.exitCode === 0 ? {} : { failureClass: checkTimedOut ? ("timeout" as const) : ("code" as const) }) });
        const firstPassed = result.exitCode === 0 && !captured.truncated;
        const runs: DiagnosticRun[] = [{ conclusion: firstPassed ? "passed" : "failed", ...(firstPassed ? {} : { failureFingerprint: createHash("sha256").update(captured.text).digest("hex") }) }];
        if (plan.required && !firstPassed) {
          while (runs.length < 1 + SANDBOX_DIAGNOSTIC_RERUN_LIMIT && diagnoseFlakiness(runs).nextRunAllowed) {
            const rerun = await sandbox.runCommand({ cmd: plan.executable, args: plan.args, cwd: "/vercel/sandbox/repo", timeoutMs: plan.timeoutMs });
            const rerunOutput = await output(rerun, plan.outputBytes), passed = rerun.exitCode === 0 && !rerunOutput.truncated;
            runs.push({ conclusion: passed ? "passed" : "failed", ...(passed ? {} : { failureFingerprint: createHash("sha256").update(rerunOutput.text).digest("hex") }) });
          }
        }
        diagnostics[plan.planId] = runs;
      }
      return { credentialTeardownProved: true, results, outputs, diagnostics, gitleaksReport: gitleaksReport.toString("utf8"), osvReport: osvReport.toString("utf8"), ...(unscannable ? { unavailableScanners: ["osvScanner" as const], unavailableReason: `osv-scanner exit ${osv.exitCode}` } : {}), stopped: true };
    } finally {
      await sandbox.stop();
    }
  }
}
