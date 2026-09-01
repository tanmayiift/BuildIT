import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../scripts/verify-production-wiring.mjs", import.meta.url));
const base = {
  ...process.env,
  BUILDIT_WEB_CONVEX_URL: "https://judicious-barracuda-968.convex.cloud",
  BUILDIT_BROKER_CONVEX_URL: "https://judicious-barracuda-968.convex.cloud",
  BUILDIT_EXPECTED_CONVEX_URL: "https://judicious-barracuda-968.convex.cloud",
};

describe("production wiring release gate", () => {
  it("accepts one shared production deployment and prints hosts only", () => {
    const result = spawnSync(process.execPath, [script], { env: base, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("web=judicious-barracuda-968.convex.cloud");
    expect(result.stdout).toContain("BuildIT production wiring matches.");
    expect(result.stdout).not.toContain("https://");
  });

  it("rejects the development and production split that breaks credential auth", () => {
    const result = spawnSync(process.execPath, [script], {
      env: { ...base, BUILDIT_WEB_CONVEX_URL: "https://tacit-coyote-455.eu-west-1.convex.cloud" },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deployments differ");
  });

  it("rejects missing and unsafe values without echoing them", () => {
    const missing = spawnSync(process.execPath, [script], {
      env: { ...base, BUILDIT_BROKER_CONVEX_URL: "" }, encoding: "utf8",
    });
    expect(missing.status).toBe(2);
    const unsafe = spawnSync(process.execPath, [script], {
      env: { ...base, BUILDIT_WEB_CONVEX_URL: "https://user:secret@example.com/path?token=hidden" }, encoding: "utf8",
    });
    expect(unsafe.status).toBe(2);
    expect(`${unsafe.stdout}${unsafe.stderr}`).not.toContain("secret");
    expect(`${unsafe.stdout}${unsafe.stderr}`).not.toContain("hidden");
  });
});
