#!/usr/bin/env node
import { runLocalReview, type CliEvent } from "./local-review.js";
import {
  credentialStatus,
  environmentKey,
  providerFrom,
  readHidden,
  revokeCredential,
  saveCredential,
  type Provider,
} from "./credential-store.js";
import {
  remoteStatus,
  requestRemoteAutofix,
  requestRemoteCommand,
  watchRemoteStatus,
} from "./remote-review.js";
import {doctorChecks} from "./doctor.js";

const args = process.argv.slice(2),
  command = args[0] ?? "help",
  value = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  },
  json = args.includes("--json"),
  emit = (item: CliEvent) => {
    process.stdout.write(
      json
        ? `${JSON.stringify(item)}\n`
        : `${item.type.replaceAll("_", " ")}: ${JSON.stringify(item.data)}\n`,
    );
  };
async function main() {
  if (command === "configure") {
    const provider = providerFrom(value("--provider"));
    if (args.includes("--revoke")) {
      revokeCredential(provider);
      emit({
        version: 1,
        type: "credential_revoked",
        at: new Date().toISOString(),
        data: { provider },
      });
      return 0;
    }
    const fromEnvironment = args.includes("--from-env"),
      key = fromEnvironment
        ? environmentKey(provider)
        : await readHidden(`${provider} API key (input hidden): `);
    if (!key)
      throw new Error(
        fromEnvironment
          ? "provider_environment_key_missing"
          : "invalid_key_format",
      );
    saveCredential(provider, key);
    emit({
      version: 1,
      type: "credential_saved",
      at: new Date().toISOString(),
      data: { provider, storage: "os_keychain" },
    });
    return 0;
  }
  if (command === "doctor") {
    const checks=doctorChecks();
    const providers = (["anthropic", "openai", "gemini"] as Provider[]).map(
        (provider) => ({ provider, status: credentialStatus(provider) }),
      ),
      result = {
        node: checks.node,
        git: checks.git,
        github:checks.github,
        providers,
        note: "Keys remain in the environment or OS keychain. Deterministic local checks do not require one.",
      };
    process.stdout.write(
      `${json ? JSON.stringify(result) : `node: ${result.node.version} (${result.node.ok?"ok":"unsupported"})\ngit: ${result.git.ok?"ok":"missing"}\ngithub: ${result.github.authenticated?(result.github.repositoryAvailable?"connected":"signed in; no repository here"):"not signed in"}\n${providers.map((item) => `${item.provider}: ${item.status}`).join("\n")}\n${result.note}`}\n`,
    );
    return checks.node.ok&&checks.git.ok?0:3;
  }
  if (command === "review") {
    if (args.includes("--remote"))
      return requestRemoteCommand({
        pr: value("--pr"),
        ...(value("--repo") ? { repo: value("--repo") } : {}),
        command: "review",
        emit,
      });
    const directory = value("--dir"),
      baseRef = value("--base"),
      managerValue = value("--manager"),
      packageManager = managerValue === undefined ? undefined : (["npm", "pnpm", "yarn"] as const).find(item => item === managerValue);
    if (managerValue !== undefined && !packageManager) throw new Error("package_manager_invalid");
    const result = await runLocalReview({
        cwd: process.cwd(),
        ...(directory ? { directory } : {}),
        ...(baseRef ? { baseRef } : {}),
        ...(packageManager ? { packageManager } : {}),
        trustWorkingConfig: args.includes("--trust-working-config"),
        confirmed: args.includes("--confirm-run"),
        emit,
      });
    return result.exitCode;
  }
  if (command === "status") {
    const statusInput = {
      pr: value("--pr"),
      ...(value("--repo") ? { repo: value("--repo") } : {}),
      emit,
    };
    if (args.includes("--watch"))
      return watchRemoteStatus({
        ...statusInput,
        intervalSeconds: value("--interval"),
        timeoutSeconds: value("--timeout"),
      });
    return remoteStatus(statusInput);
  }
  if (command === "cancel")
    return requestRemoteCommand({
      pr: value("--pr"),
      ...(value("--repo") ? { repo: value("--repo") } : {}),
      command: "cancel",
      emit,
    });
  if (command === "autofix") {
    if (!args.includes("--remote") || !args.includes("--stacked"))
      throw new Error("autofix_requires_hosted_stacked_pr");
    return requestRemoteAutofix({
      pr: value("--pr"),
      ...(value("--repo") ? { repo: value("--repo") } : {}),
      confirmed: args.includes("--confirm-stacked-pr"),
      emit,
    });
  }
  process.stdout.write(
    "BuildIT CLI\n\nCommands:\n  buildit configure --provider <anthropic|openai|gemini> [--from-env|--revoke]\n  buildit review [--dir path] [--base ref] [--manager npm|pnpm|yarn] [--trust-working-config] [--confirm-run] [--json]\n  buildit review --remote --pr <number> [--repo owner/name] [--json]\n  buildit autofix --remote --stacked --confirm-stacked-pr --pr <number> [--repo owner/name] [--json]\n  buildit status --pr <number> [--repo owner/name] [--watch] [--interval seconds] [--timeout seconds] [--json]\n  buildit cancel --pr <number> [--repo owner/name] [--json]\n  buildit doctor [--json]\n\nNever pass a key as a command argument. Local review first prints the exact zero-provider-cost command plan and runs it only with --confirm-run; if a repository has more than one lockfile, pass --manager only after choosing the intended package manager. It includes committed, staged, unstaged, and untracked files without uploading or writing to the worktree. Remote commands use your existing GitHub CLI login; BuildIT rechecks collaborator permission and the PR head. Status --watch reads GitHub Checks repeatedly and is resumable by rerunning the same command. Autofix is limited to a stacked PR and never merges.\n",
  );
  return command === "help" || command === "--help" ? 0 : 4;
}
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    emit({
      version: 1,
      type: "error",
      at: new Date().toISOString(),
      data: { code: error instanceof Error ? error.message : "cli_failed" },
    });
    process.exitCode = 4;
  });
