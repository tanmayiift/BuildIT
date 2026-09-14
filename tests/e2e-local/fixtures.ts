import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
export const cloud = "http://127.0.0.1:3218";
const runtime = resolve(process.cwd(), ".local/audit-runtime");
export const fixtures = JSON.parse(readFileSync(resolve(runtime, "fixtures.json"), "utf8")) as Record<"A" | "B", { token: string; userId: string; sessionId: string; organizationId: string; repositoryId: string; reviewId: string }>;
export async function call(kind: "query" | "mutation", path: string, args: Record<string, unknown>, identity: "A" | "B" | "admin") {
  const token = identity === "admin" ? JSON.parse(readFileSync(resolve(runtime, "secrets.json"), "utf8")).adminKey : fixtures[identity].token;
  const response = await fetch(`${cloud}/api/${kind}`, { method: "POST", headers: { authorization: `${identity === "admin" ? "Convex" : "Bearer"} ${token}`, "content-type": "application/json" }, body: JSON.stringify({ path, args, format: "json" }) });
  return response.json();
}
export async function signIn(page: Page, name: "A" | "B") {
  // Prevent accidental integration traffic; test identities and fixtures are local-only.
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname) ? route.continue() : route.abort("blockedbyclient");
  });
  const session = await call("mutation", "auditSeed:browserSession", { userId: fixtures[name].userId, sessionId: fixtures[name].sessionId }, "admin");
  if (session.status !== "success" || typeof session.value?.refreshToken !== "string") throw new Error("local_browser_session_failed");
  await page.addInitScript(({ token, refreshToken }) => {
    localStorage.setItem("__convexAuthJWT_http1270013218", token);
    localStorage.setItem("__convexAuthRefreshToken_http1270013218", refreshToken);
  }, { token: fixtures[name].token, refreshToken: session.value.refreshToken });
}
