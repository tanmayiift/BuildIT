import { describe, expect, it, vi } from "vitest";
import {
  credentialStatus,
  environmentKey,
  providerFrom,
  readCredential,
  revokeCredential,
  saveCredential,
  type Runner,
} from "./credential-store.js";
describe("CLI credential boundary", () => {
  it("accepts only named providers and never a key argument", () => {
    expect(providerFrom("gemini")).toBe("gemini");
    expect(() => providerFrom("custom")).toThrow("provider_required");
    expect(
      environmentKey("gemini", { GEMINI_API_KEY: "long-enough-secret-value" }),
    ).toBe("long-enough-secret-value");
  });
  it("stores a macOS key through stdin rather than process arguments", () => {
    const run = vi.fn<Runner>(() => ({ status: 0 }));
    saveCredential("gemini", "long-enough-secret-value", {
      platform: "darwin",
      run,
    });
    const [command, args, options] = run.mock.calls[0]!;
    expect(command).toBe("security");
    expect(args).not.toContain("long-enough-secret-value");
    expect(options.input).toBe("long-enough-secret-value");
    expect(options.stdio).toEqual(["pipe", "ignore", "ignore"]);
  });
  it("uses Secret Service on Linux without stdout and reports only readiness", () => {
    const run = vi.fn<Runner>(() => ({ status: 0 }));
    saveCredential("openai", "long-enough-secret-value", {
      platform: "linux",
      run,
    });
    expect(run.mock.calls[0]?.[0]).toBe("secret-tool");
    expect(run.mock.calls[0]?.[1]).not.toContain("long-enough-secret-value");
    expect(
      credentialStatus("openai", { platform: "linux", environment: {}, run }),
    ).toBe("keychain");
  });
  it("fails closed on unsupported keychains and allows idempotent absence on revoke", () => {
    expect(() =>
      saveCredential("anthropic", "long-enough-secret-value", {
        platform: "win32",
      }),
    ).toThrow("secure_keychain_unavailable");
    const run = vi.fn<Runner>(() => ({ status: 1 }));
    expect(() =>
      revokeCredential("anthropic", { platform: "darwin", run }),
    ).not.toThrow();
  });
  it("rejects line breaks, short values, and oversize values", () => {
    for (const key of [
      "short",
      "long-enough-secret\nvalue",
      "x".repeat(16_385),
    ])
      expect(() =>
        saveCredential("gemini", key, { platform: "darwin", run: vi.fn() }),
      ).toThrow("invalid_key_format");
  });
});

// The key was written to the keychain and could only be checked for presence, so every other
// internal tool needed the same secret pasted into its own environment again.
describe("one key, read by whatever needs it", () => {
  const secret = "sk-proj-long-enough-secret-value";

  it("reads the key `buildit configure` stored, on macOS", () => {
    const calls: string[][] = [];
    const value = readCredential("openai", {
      platform: "darwin", environment: {},
      read: (command, args) => { calls.push([command, ...args]); return { status: 0, stdout: `${secret}\n` }; },
    });
    expect(value).toBe(secret);
    // The same service name `saveCredential` writes under, or it would read nothing.
    expect(calls[0]).toEqual(["security", "find-generic-password", "-a", "default", "-s", "dev.buildit.model-key.openai", "-w"]);
  });

  it("reads it on Linux", () => {
    expect(readCredential("openai", {
      platform: "linux", environment: {}, read: () => ({ status: 0, stdout: secret }),
    })).toBe(secret);
  });

  it("prefers an explicit environment key over the stored one", () => {
    const environmentSecret = "env-supplied-secret-value";
    expect(readCredential("openai", {
      platform: "darwin", environment: { OPENAI_API_KEY: environmentSecret },
      read: () => { throw new Error("keychain must not be consulted"); },
    })).toBe(environmentSecret);
  });

  it("returns nothing rather than a fragment when the keychain has no entry", () => {
    expect(readCredential("openai", { platform: "darwin", environment: {}, read: () => ({ status: 1, stdout: "" }) })).toBeUndefined();
    expect(readCredential("openai", { platform: "darwin", environment: {}, read: () => ({ status: 0, stdout: "short\n" }) })).toBeUndefined();
    expect(readCredential("openai", { platform: "win32", environment: {}, read: () => ({ status: 0, stdout: secret }) })).toBeUndefined();
  });
});
