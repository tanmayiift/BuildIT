import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

describe("AWS verification credential transport", () => {
  it("forwards AWS authentication to the read-only CLI without forwarding unrelated secrets", () => {
    const source = readFileSync(new URL("../../scripts/verify-aws-boundary.mjs", import.meta.url), "utf8");
    const functions = source.slice(source.indexOf("function aws"), source.indexOf("function requireTrue"));
    const spawnSync = vi.fn(() => ({ status: 0, stdout: "{}" }));
    runInNewContext(`${functions}\naws(["cloudformation", "describe-stacks"]);`, {
      spawnSync, region: "eu-west-1", process: { env: {
        PATH: "/usr/bin", AWS_ACCESS_KEY_ID: "fake-key", AWS_SECRET_ACCESS_KEY: "fake-secret",
        AWS_SESSION_TOKEN: "fake-session", HOME: "/tmp/fake-home", UNRELATED_SECRET: "must-not-forward",
      } },
    });
    const options = (spawnSync.mock.calls as unknown as [string, string[], { env: Record<string, string> }][])[0]![2];
    expect(options.env).toMatchObject({ AWS_ACCESS_KEY_ID: "fake-key", AWS_SECRET_ACCESS_KEY: "fake-secret", AWS_SESSION_TOKEN: "fake-session", HOME: "/tmp/fake-home" });
    expect(options.env).not.toHaveProperty("UNRELATED_SECRET");
  });
});
