import { spawnSync } from "node:child_process";
export type Provider = "anthropic" | "openai" | "gemini";
export type Runner = (
  command: string,
  args: string[],
  options: { input?: string; stdio?: ["pipe" | "ignore", "ignore", "ignore"] },
) => { status: number | null; error?: Error };
const environmentNames: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};
const service = (provider: Provider) => `dev.buildit.model-key.${provider}`;
export function providerFrom(value: string | undefined): Provider {
  if (value === "anthropic" || value === "openai" || value === "gemini")
    return value;
  throw new Error("provider_required");
}
export function environmentKey(
  provider: Provider,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const value = environment[environmentNames[provider]];
  return value && value.length >= 16 ? value : undefined;
}
function execute(
  command: string,
  args: string[],
  options: {
    input?: string;
    stdio?: ["pipe" | "ignore", "ignore", "ignore"];
  } = {},
): { status: number | null; error?: Error } {
  return spawnSync(command, args, {
    timeout: 10_000,
    windowsHide: true,
    ...options,
  });
}
export function keychainSupported(platform = process.platform) {
  return platform === "darwin" || platform === "linux";
}
export function credentialStatus(
  provider: Provider,
  input: {
    platform?: NodeJS.Platform;
    environment?: NodeJS.ProcessEnv;
    run?: Runner;
  } = {},
) {
  if (environmentKey(provider, input.environment))
    return "environment" as const;
  const platform = input.platform ?? process.platform,
    run = input.run ?? execute;
  if (platform === "darwin")
    return run(
      "security",
      ["find-generic-password", "-a", "default", "-s", service(provider)],
      { stdio: ["ignore", "ignore", "ignore"] },
    ).status === 0
      ? ("keychain" as const)
      : ("missing" as const);
  if (platform === "linux")
    return run(
      "secret-tool",
      ["lookup", "service", "BuildIT", "provider", provider],
      { stdio: ["ignore", "ignore", "ignore"] },
    ).status === 0
      ? ("keychain" as const)
      : ("missing" as const);
  return "unsupported_keychain" as const;
}
export function saveCredential(
  provider: Provider,
  key: string,
  input: { platform?: NodeJS.Platform; run?: Runner } = {},
) {
  if (key.length < 16 || key.length > 16_384 || /[\r\n\0]/.test(key))
    throw new Error("invalid_key_format");
  const platform = input.platform ?? process.platform,
    run = input.run ?? execute;
  const result =
    platform === "darwin"
      ? run(
          "security",
          [
            "add-generic-password",
            "-U",
            "-a",
            "default",
            "-s",
            service(provider),
            "-w",
          ],
          { input: key, stdio: ["pipe", "ignore", "ignore"] },
        )
      : platform === "linux"
        ? run(
            "secret-tool",
            [
              "store",
              "--label",
              `BuildIT ${provider} model key`,
              "service",
              "BuildIT",
              "provider",
              provider,
            ],
            { input: key, stdio: ["pipe", "ignore", "ignore"] },
          )
        : null;
  if (!result) throw new Error("secure_keychain_unavailable");
  if (result.error || result.status !== 0)
    throw new Error("keychain_write_failed");
}
export function revokeCredential(
  provider: Provider,
  input: { platform?: NodeJS.Platform; run?: Runner } = {},
) {
  const platform = input.platform ?? process.platform,
    run = input.run ?? execute;
  const lookup = platform === "darwin"
    ? run("security", ["find-generic-password", "-a", "default", "-s", service(provider)], { stdio: ["ignore", "ignore", "ignore"] })
    : platform === "linux"
      ? run("secret-tool", ["lookup", "service", "BuildIT", "provider", provider], { stdio: ["ignore", "ignore", "ignore"] })
      : null;
  if (!lookup) throw new Error("secure_keychain_unavailable");
  if (lookup.error) throw new Error("keychain_revoke_failed");
  if (lookup.status !== 0) return;
  const result =
    platform === "darwin"
      ? run(
          "security",
          ["delete-generic-password", "-a", "default", "-s", service(provider)],
          { stdio: ["ignore", "ignore", "ignore"] },
        )
      : platform === "linux"
        ? run(
            "secret-tool",
            ["clear", "service", "BuildIT", "provider", provider],
            { stdio: ["ignore", "ignore", "ignore"] },
          )
        : null;
  if (!result) throw new Error("secure_keychain_unavailable");
  if (result.error || result.status !== 0)
    throw new Error("keychain_revoke_failed");
}
export async function readHidden(
  prompt: string,
  input = process.stdin,
  output = process.stderr,
): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== "function")
    throw new Error("interactive_terminal_required");
  output.write(prompt);
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener("data", onData);
      output.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string | Buffer) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") return finish(new Error("cancelled"));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f") value = value.slice(0, -1);
        else if (character >= " " && value.length < 16_384) value += character;
      }
    };
    input.on("data", onData);
  });
}
export type Reader = (
  command: string,
  args: string[],
) => { status: number | null; stdout?: string | Buffer; error?: Error };
// The key was written to the keychain by `buildit configure` and could only be checked for
// presence, never read back - so every other internal tool needed the same secret pasted into its
// own environment again. One store, read by whatever needs it, is the point of storing it.
export function readCredential(
  provider: Provider,
  input: {
    platform?: NodeJS.Platform;
    environment?: NodeJS.ProcessEnv;
    read?: Reader;
  } = {},
): string | undefined {
  const fromEnvironment = environmentKey(provider, input.environment);
  if (fromEnvironment) return fromEnvironment;
  const platform = input.platform ?? process.platform;
  const read =
    input.read ??
    ((command: string, args: string[]) =>
      spawnSync(command, args, {
        timeout: 10_000,
        windowsHide: true,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }));
  const result =
    platform === "darwin"
      ? read("security", [
          "find-generic-password",
          "-a",
          "default",
          "-s",
          service(provider),
          "-w",
        ])
      : platform === "linux"
        ? read("secret-tool", [
            "lookup",
            "service",
            "BuildIT",
            "provider",
            provider,
          ])
        : null;
  if (!result || result.error || result.status !== 0) return undefined;
  // `security -w` appends a newline; secret-tool does not. Trimming is safe because a key with
  // surrounding whitespace was rejected at write time.
  const value = String(result.stdout ?? "").trim();
  return value.length >= 16 ? value : undefined;
}
