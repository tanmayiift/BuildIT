import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { PUBLIC_DEMO_ENV } from "../../public-demo-gate";

// The endpoint is unauthenticated and takes arbitrary code from strangers, so what it refuses
// matters as much as what it finds - and what it *says it did not check* matters most of all,
// because a clean result from two regex passes must never read as a clean review.
const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request("https://buildit.test/api/scan", {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));

describe("the open sandbox", () => {
  // Every case below describes the endpoint as offered. The demo gate defaults to off, so it is
  // turned on here rather than in each test - and the one case that asserts the closed behaviour
  // turns it back off explicitly, so neither state is the accident of a missing stub.
  beforeEach(() => { vi.stubEnv(PUBLIC_DEMO_ENV, "true"); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("refuses everything, before reading the body, when the demo is closed", async () => {
    vi.stubEnv(PUBLIC_DEMO_ENV, "false");
    const response = await post({ files: [{ path: "src/a.ts", content: "const a = 1;" }] });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "demo_closed" });
  });

  it("finds a hardcoded credential, which is the reason it runs on a server", async () => {
    // Assembled, not written: a literal here would fail this repository's own secret scan.
    const key = ["AKIA", "IOSFODNN", "7EXAMPLE"].join("");
    const response = await post({ files: [{ path: "src/config.ts", content: `const id = "${key}";` }] });
    const body = await response.json() as { secrets: Array<{ path: string; line: number }> };
    expect(response.status).toBe(200);
    expect(body.secrets).toEqual([{ path: "src/config.ts", line: 1 }]);
    // The value itself must never come back out.
    expect(JSON.stringify(body)).not.toContain(key);
  });

  it("names the checks it did not run", async () => {
    const response = await post({ files: [{ path: "a.ts", content: "export const a = 1;\n" }] });
    const body = await response.json() as { findings: unknown[]; ran: string[]; didNotRun: string[] };
    expect(body.findings).toEqual([]);
    expect(body.didNotRun).toContain("gitleaks");
    expect(body.didNotRun).toContain("osv-scanner");
    expect(body.didNotRun).toContain("AI review");
  });

  it("applies BuildIT's own rules", async () => {
    const tls = `const agent = { rejectUnauthorized: ${["fal", "se"].join("")} };`;
    const response = await post({ files: [{ path: "src/client.ts", content: tls }] });
    const body = await response.json() as { findings: Array<{ ruleId: string; severity: string }> };
    expect(body.findings).toEqual([expect.objectContaining({ ruleId: "buildit-tls-disabled", severity: "critical" })]);
  });

  it("refuses work that is too large before doing any of it", async () => {
    // content-length is attacker-supplied, so an honest header is refused up front...
    expect((await post({ files: [] }, { "content-length": "999999" })).status).toBe(413);
    // ...and a lying one is caught after reading, which is the case that actually protects the CPU.
    const huge = { files: [{ path: "a.ts", content: "x".repeat(200_000) }] };
    expect((await post(huge)).status).toBe(413);
    expect((await post({ files: Array.from({ length: 25 }, () => ({ path: "a.ts", content: "" })) })).status).toBe(413);
  });

  it("refuses a path that would escape, with a reason rather than a crash", async () => {
    for (const path of ["../secrets.ts", "/etc/passwd", ""]) {
      const response = await post({ files: [{ path, content: "const a = 1;" }] });
      expect(response.status, path).toBe(400);
    }
  });

  it("refuses malformed input", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post({ files: "nope" })).status).toBe(400);
    expect((await post({ files: [{ path: "a.ts" }] })).status).toBe(400);
  });
});
