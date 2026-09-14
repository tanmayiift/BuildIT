// Actual local Convex runtime and WebSocket checks. This does not call a model or GitHub.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const cloud = "http://127.0.0.1:3218";
const fixtures = JSON.parse(readFileSync(new URL("../../.local/audit-runtime/fixtures.json", import.meta.url), "utf8"));
const { adminKey } = JSON.parse(readFileSync(new URL("../../.local/audit-runtime/secrets.json", import.meta.url), "utf8"));
const evidence = { startedAt: new Date().toISOString(), runtime: process.version, environment: "loopback-only Convex with simulated identities", checks: [], figures: {}, externalPaidCalls: 0, browserChecks: 0 };
async function call(kind, path, args, identity = "A") {
  const response = await fetch(`${cloud}/api/${kind}`, { method: "POST", headers: { authorization: identity === "admin" ? `Convex ${adminKey}` : `Bearer ${fixtures[identity].token}`, "content-type": "application/json" }, body: JSON.stringify({ path, args, format: "json" }), signal: globalThis.AbortSignal.timeout(20_000) });
  return response.json();
}
async function success(kind, path, args, identity) {
  const result = await call(kind, path, args, identity);
  assert.equal(result.status, "success", `${path}: ${result.errorMessage ?? "request failed"}`);
  return result.value;
}
function check(name, condition) { assert.ok(condition, name); evidence.checks.push(name); }
function observe(client, path, args) {
  const values = [];
  const off = client.onUpdate(makeFunctionReference(path), args, value => values.push(value), error => { values.push({ subscriptionError: error.message }); });
  return { values, off, async wait(predicate) {
    const until = Date.now() + 20_000;
    while (Date.now() < until) {
      const error = values.find(value => value.subscriptionError);
      if (error) throw new Error(`${path}: ${error.subscriptionError}`);
      const match = values.find(predicate); if (match) return match;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`subscription_update_timeout:${path}`);
  } };
}

const owner = fixtures.A, viewer = fixtures.B;
const client = new ConvexClient(cloud, { webSocketConstructor: globalThis.WebSocket, logger: false });
client.setAuth(async () => owner.token);
const subscriptions = [];
try {
  for (const identity of ["A", "B"]) {
    await success("mutation", "auditSeed:refreshAuth", { userId: fixtures[identity].userId }, "admin");
    const connection = await success("query", "repositoryConnections:current", {}, identity);
    check(`${identity}: authenticated workspace and role`, connection.organization.id === fixtures[identity].organizationId && connection.organization.role === (identity === "A" ? "owner" : "viewer"));
  }
  const org = { organizationId: owner.organizationId };
  await success("mutation", "usage:prepare", org);
  const usage = await success("query", "usage:summarize", org);
  const snapshot = await success("query", "modelAccounting:snapshot", { ...org, now: Date.now() }, "admin");
  check("usage and enforcement share exact budget snapshot", JSON.stringify(usage.budget) === JSON.stringify(snapshot));
  check("provider cost appears in budget", snapshot.estimatedSpendUsd >= 12.5 && usage.costs.provider_billed === snapshot.estimatedSpendUsd);
  check("initial USD limit is 100", snapshot.monthlyBudgetUsd === 100);
  check("legacy reconstruction remains explicitly incomplete", snapshot.reconciliationComplete && snapshot.legacyCostsMayBeIncomplete && !snapshot.accountingComplete);
  check("Ask tokens retained in quantities", usage.quantities.ask_tokens >= 1000);
  evidence.figures.before = { spendUsd: snapshot.estimatedSpendUsd, limitUsd: snapshot.monthlyBudgetUsd, percent: snapshot.estimatedSpendUsd / snapshot.monthlyBudgetUsd * 100, measuredTokens: usage.quantities.model_tokens + usage.quantities.ask_tokens };
  const metrics = observe(client, "metrics:summarize", org); subscriptions.push(metrics);
  const initialMetrics = await metrics.wait(value => value.totals);
  await success("mutation", "auditSeed:addMetric", { ...org, reviewId: owner.reviewId }, "admin");
  const newMetrics = await metrics.wait(value => value.recordCount === initialMetrics.recordCount + 1);
  check("WebSocket metric subscription includes event inserted after subscription", newMetrics.totals.review_completed === initialMetrics.totals.review_completed + 1);
  evidence.figures.metricRuns = [initialMetrics.totals.review_completed, newMetrics.totals.review_completed];
  const costs = observe(client, "usage:summarize", org); subscriptions.push(costs);
  await costs.wait(value => value.budget?.estimatedSpendUsd === snapshot.estimatedSpendUsd);
  const reservation = await success("mutation", "modelAccounting:reserve", { ...org, reviewId: owner.reviewId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0, invocationKey: randomUUID(), requestHash: "f".repeat(64), stage: "ask", provider: "anthropic", model: "claude-sonnet-4-5", inputBytes: 4000, maxOutputTokens: 200, now: Date.now() }, "admin");
  check("local synthetic invocation obtains atomic reservation", reservation.allowed);
  const reserved = await costs.wait(value => value.budget?.reservedUsd === reservation.reservedUsd);
  check("pending reservation updates subscription without adding trusted spend", reserved.budget.estimatedSpendUsd === snapshot.estimatedSpendUsd && reserved.budget.unknownInvocationCount === 1);
  const settleArgs = { ...org, invocationId: reservation.invocationId, outcome: "estimated", inputTokens: 1000, outputTokens: 200, finishReason: "local_fake_complete", now: Date.now() };
  const settled = await success("mutation", "modelAccounting:settle", settleArgs, "admin");
  const expected = Math.round((snapshot.estimatedSpendUsd + settled.costUsd) * 1_000_000) / 1_000_000;
  const after = await costs.wait(value => value.budget?.estimatedSpendUsd === expected && value.budget.reservedUsd === 0);
  check("settled synthetic charge updates existing subscription and releases reservation", settled.accounted && after.budget.unknownInvocationCount === 0);
  const afterGate = await success("query", "modelAccounting:snapshot", { ...org, now: Date.now() }, "admin");
  check("post-settlement budget page and gate snapshots match", JSON.stringify(after.budget) === JSON.stringify(afterGate));
  await success("mutation", "modelAccounting:settle", settleArgs, "admin");
  const replay = await success("query", "modelAccounting:snapshot", { ...org, now: Date.now() }, "admin");
  check("duplicate settlement does not add charge", replay.estimatedSpendUsd === expected);
  evidence.figures.after = { spendUsd: expected, limitUsd: after.budget.monthlyBudgetUsd, percent: expected, settledFakeChargeUsd: settled.costUsd, reservedUsd: after.budget.reservedUsd };
  for (const path of ["usage:summarize", "metrics:summarize", "reviewHistory:summary", "reviews:list"]) {
    const denied = await call("query", path, { ...org, ...(path === "reviewHistory:summary" ? { since: 0 } : {}) }, "B");
    check(`${path}: cross-workspace query denied`, denied.status === "error" && denied.errorMessage.includes("not_found_or_forbidden"));
  }
  for (const organizationId of [owner.organizationId, viewer.organizationId]) {
    const denied = await call("mutation", "organizations:updateCapacity", { organizationId, monthlyBudget: 999, requestId: randomUUID() }, "B");
    check(`viewer budget write denied (${organizationId === owner.organizationId ? "other" : "own"} workspace)`, denied.status === "error" && denied.errorMessage.includes("not_found_or_forbidden"));
  }
  await success("mutation", "organizations:updateCapacity", { ...org, monthlyBudget: 0, requestId: randomUUID() });
  const unlimited = await success("query", "usage:summarize", org);
  check("owner can remove limit; unlimited allowance has no fake remaining number", unlimited.budget.monthlyBudgetUsd === 0 && unlimited.budget.remainingUsd === null);
  await success("mutation", "organizations:updateCapacity", { ...org, monthlyBudget: 100, requestId: randomUUID() });
  const restored = await success("query", "usage:summarize", org);
  check("owner can restore USD limit without resetting spend", restored.budget.monthlyBudgetUsd === 100 && restored.budget.estimatedSpendUsd === expected);
  await success("mutation", "usage:prepare", { organizationId: viewer.organizationId }, "B");
  const viewerUsage = await success("query", "usage:summarize", { organizationId: viewer.organizationId }, "B");
  check("other tenant spend unaffected", viewerUsage.budget.estimatedSpendUsd === 3.75);
  const policy = { ...org, repositoryId: owner.repositoryId, autofixMode: "stacked", reviewProfile: "quiet" };
  await success("mutation", "repositoryConnections:setReviewPolicy", { ...policy, paused: true, requestId: randomUUID() });
  const paused = await success("query", "repositoryConnections:current", {});
  check("owner repository pause persists", paused.repositories.find(repository => repository.id === owner.repositoryId).paused);
  await success("mutation", "repositoryConnections:setReviewPolicy", { ...policy, paused: false, requestId: randomUUID() });
  const resumed = await success("query", "repositoryConnections:current", {});
  const repository = resumed.repositories.find(repository => repository.id === owner.repositoryId);
  check("owner repository resume persists", !repository.paused);
  check("owner inline comment level persists", repository.reviewProfile === "quiet");
  const forbiddenPolicy = await call("mutation", "repositoryConnections:setReviewPolicy", { ...policy, organizationId: viewer.organizationId, repositoryId: viewer.repositoryId, paused: true, requestId: randomUUID() }, "B");
  check("viewer repository policy write denied", forbiddenPolicy.status === "error" && forbiddenPolicy.errorMessage.includes("not_found_or_forbidden"));
  evidence.completedAt = new Date().toISOString();
  evidence.status = "passed";
} catch (error) { evidence.status = "failed"; evidence.error = error.message; process.exitCode = 1; }
finally {
  for (const subscription of subscriptions) subscription.off();
  await client.close();
  writeFileSync(new URL("../../audit/evidence/local-browser-api-proof.json", import.meta.url), JSON.stringify(evidence, null, 2) + "\n");
  console.log(`${evidence.checks.length} local API/WebSocket checks ${evidence.status}; browser checks remain unexecuted.`);
  if (evidence.error) console.error(evidence.error);
}
