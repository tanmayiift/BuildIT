import { describe, expect, it } from "vitest";
import { originAllowed } from "../src/http.js";

const deployed = "https://buildit-agentic-review.vercel.app";
const development = "http://localhost:3000";

describe("credential broker origin allowlist", () => {
  it("accepts a single configured origin", () => {
    expect(originAllowed(deployed, deployed)).toBe(true);
  });

  it("permits a development origin without dropping the deployed one", () => {
    const configured = `${deployed},${development}`;
    expect(originAllowed(deployed, configured)).toBe(true);
    expect(originAllowed(development, configured)).toBe(true);
  });

  it("tolerates whitespace between configured entries", () => {
    expect(originAllowed(development, `${deployed}, ${development}`)).toBe(true);
  });

  it("refuses a missing origin", () => {
    expect(originAllowed(null, deployed)).toBe(false);
    expect(originAllowed("", deployed)).toBe(false);
  });

  it("matches exactly and never by prefix, suffix, or subdomain", () => {
    const configured = `${deployed},${development}`;
    for (const hostile of [
      "https://buildit-agentic-review.vercel.app.evil.test",
      "https://evil.test/buildit-agentic-review.vercel.app",
      "https://attacker.buildit-agentic-review.vercel.app",
      "http://localhost:3001",
      "https://localhost:3000",
      "*",
      "null",
    ]) expect(originAllowed(hostile, configured)).toBe(false);
  });

  it("does not let an empty configured entry match anything", () => {
    expect(originAllowed("https://evil.test", `${deployed},,`)).toBe(false);
  });
});
