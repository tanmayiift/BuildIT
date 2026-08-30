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
import { remoteStatus, requestRemoteCommand } from "./remote-review.js";

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
    const providers = (["anthropic", "openai", "gemini"] as Provider[]).map(
        (provider) => ({ provider, status: credentialStatus(provider) }),
      ),
      result = {
        node: process.version,
        git: true,
        providers,
        note: "Keys remain in the environment or OS keychain. Deterministic local checks do not require one.",
      };
    process.stdout.write(
      `${json ? JSON.stringify(result) : `node: ${result.node}\ngit: true\n${providers.map((item) => `${item.provider}: ${item.status}`).join("\n")}\n${result.note}`}\n`,
    );
    return 0;
  }
  if (command === "review") {
    if (args.includes("--remote")) return requestRemoteCommand({ pr: value("--pr"), ...(value("--repo") ? { repo: value("--repo") } : {}), command: "review", emit });
    const directory = value("--dir"),
      result = await runLocalReview({
        cwd: process.cwd(),
        ...(directory ? { directory } : {}),
        emit,
      });
    return result.exitCode;
  }
  if (command === "status") return remoteStatus({ pr: value("--pr"), ...(value("--repo") ? { repo: value("--repo") } : {}), emit });
  if (command === "cancel") return requestRemoteCommand({ pr: value("--pr"), ...(value("--repo") ? { repo: value("--repo") } : {}), command: "cancel", emit });
  if (command === "autofix") throw new Error("autofix_requires_hosted_consent");
  process.stdout.write(
    "BuildIT CLI\n\nCommands:\n  buildit configure --provider <anthropic|openai|gemini> [--from-env|--revoke]\n  buildit review [--dir path] [--json]\n  buildit review --remote --pr <number> [--repo owner/name] [--json]\n  buildit status --pr <number> [--repo owner/name] [--json]\n  buildit cancel --pr <number> [--repo owner/name] [--json]\n  buildit doctor [--json]\n\nNever pass a key as a command argument. Remote commands use your existing GitHub CLI login; BuildIT rechecks collaborator permission. Local review runs deterministic checks only. Autofix requires separate hosted consent.\n",
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
