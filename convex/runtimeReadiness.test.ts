/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { EXECUTION_GATE_ENV, REVIEW_RUNTIME_ENV } from "./lib/executionGate";

// This query ANDed two unrelated facts into one boolean before any client saw them: the deliberate
// execution safety switch, and whether this deployment holds the eight REVIEW_RUNTIME_ENV values a
// review needs. Flattened, the interface could only tell the safety story - so a rotated secret
// nobody re-set was reported to a paying owner as their repository being held back on safety
// grounds. requireExecutionEnabled already throws two different codes for the two causes; the wire
// type has to carry both too, or no screen can ever name the right one.
const modules = import.meta.glob("./**/*.ts");
const readinessQuery = makeFunctionReference<"query", Record<string, never>, { executionEnabled: boolean; runtimeConfigured: boolean }>("runtimeReadiness:current");

// Deliberately not secret-shaped. What is being tested is present-and-non-blank, nothing else.
const placeholder = "configured-for-this-test";

function environment({ gate, missing }: { gate: string; missing?: string }) {
  vi.stubEnv(EXECUTION_GATE_ENV, gate);
  for (const name of REVIEW_RUNTIME_ENV) vi.stubEnv(name, name === missing ? "" : placeholder);
}

const signedIn = () => convexTest(schema, modules).withIdentity({ subject: "reader", issuer: "https://example.test" });

afterEach(() => vi.unstubAllEnvs());

describe("runtimeReadiness:current reports two facts, not one", () => {
  it("separates a missing BuildIT secret from the safety gate", async () => {
    environment({ gate: "true", missing: "BUILDIT_BROKER_URL" });
    expect(await signedIn().query(readinessQuery, {})).toEqual({ executionEnabled: true, runtimeConfigured: false });
  });

  it("reports every one of the eight values it depends on", async () => {
    for (const name of REVIEW_RUNTIME_ENV) {
      environment({ gate: "true", missing: name });
      expect(await signedIn().query(readinessQuery, {}), `${name} being unset was not reported`)
        .toEqual({ executionEnabled: true, runtimeConfigured: false });
    }
  });

  it("still reports the deliberate safety gate as its own fact", async () => {
    environment({ gate: "false" });
    expect(await signedIn().query(readinessQuery, {})).toEqual({ executionEnabled: false, runtimeConfigured: true });
  });

  it("reports both true only when both are true", async () => {
    environment({ gate: "true" });
    expect(await signedIn().query(readinessQuery, {})).toEqual({ executionEnabled: true, runtimeConfigured: true });
  });

  it("claims neither for a caller with no identity", async () => {
    environment({ gate: "true" });
    expect(await convexTest(schema, modules).query(readinessQuery, {})).toEqual({ executionEnabled: false, runtimeConfigured: false });
  });
});
