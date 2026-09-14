import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { call, fixtures, signIn } from "./fixtures";

test("owner sees real provider costs and can save or remove the monthly limit", async ({ page }) => {
  await signIn(page, "A");
  await call("mutation", "usage:prepare", { organizationId: fixtures.A.organizationId }, "A");
  const initial = await call("query", "usage:summarize", { organizationId: fixtures.A.organizationId }, "A");
  expect(initial.status).toBe("success");
  const expectedPercent = initial.value.budget.estimatedSpendUsd;
  const tokens = initial.value.quantities.model_tokens + initial.value.quantities.ask_tokens;
  await page.goto("/usage");
  const bar = page.getByRole("progressbar", { name: "Estimated model spend" });
  await expect(bar).toHaveAttribute("aria-valuenow", String(expectedPercent));
  await expect(page.getByText(new RegExp(`${tokens.toLocaleString("en-US")} model tokens including Ask`))).toBeVisible();
  await expect(page.getByText(/Storage usage is not measured/)).toBeVisible();
  await page.screenshot({ path: "audit/evidence/local-browser-usage-owner.png", fullPage: true });
  await page.getByLabel("Monthly model limit · USD").fill("0"); await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("No monthly limit", { exact: true })).toBeVisible();
  await expect(bar).toHaveCount(0);
  await page.getByLabel("Monthly model limit · USD").fill("100"); await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(bar).toHaveAttribute("aria-valuenow", String(expectedPercent));
});

test("new metric records update the already-open page", async ({ page }) => {
  await signIn(page, "A");
  const initial = await call("query", "metrics:summarize", { organizationId: fixtures.A.organizationId }, "A");
  expect(initial.status).toBe("success");
  const initialRuns = initial.value.totals.review_completed;
  await page.goto("/metrics");
  const figure = page.locator("article.metric").filter({ hasText: "Completed review runs" }).locator("strong");
  await expect(figure).toHaveText(String(initialRuns));
  const result = await call("mutation", "auditSeed:addMetric", { organizationId: fixtures.A.organizationId, reviewId: fixtures.A.reviewId }, "admin");
  expect(result.status).toBe("success");
  await expect(figure).toHaveText(String(initialRuns + 1));
  await page.screenshot({ path: "audit/evidence/local-browser-metrics-reactive.png", fullPage: true });
});

test("a reserved and settled model invocation updates the open budget bar", async ({ page }) => {
  await signIn(page, "A");
  await call("mutation", "usage:prepare", { organizationId: fixtures.A.organizationId }, "A");
  const initial = await call("query", "usage:summarize", { organizationId: fixtures.A.organizationId }, "A");
  expect(initial.status).toBe("success");
  const initialSpend = initial.value.budget.estimatedSpendUsd;
  await page.goto("/usage");
  const bar = page.getByRole("progressbar", { name: "Estimated model spend" });
  await expect(bar).toHaveAttribute("aria-valuenow", String(initialSpend));
  const invocation = await call("mutation", "modelAccounting:reserve", { organizationId: fixtures.A.organizationId, reviewId: fixtures.A.reviewId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0, invocationKey: randomUUID(), requestHash: "f".repeat(64), stage: "ask", provider: "anthropic", model: "claude-sonnet-4-5", inputBytes: 4000, maxOutputTokens: 200, now: Date.now() }, "admin");
  expect(invocation.status).toBe("success"); expect(invocation.value.allowed).toBe(true);
  await expect(page.getByText(/reserved for pending or uncertain model calls/)).toBeVisible();
  const settled = await call("mutation", "modelAccounting:settle", { organizationId: fixtures.A.organizationId, invocationId: invocation.value.invocationId, outcome: "estimated", inputTokens: 1000, outputTokens: 200, finishReason: "local_fake_complete", now: Date.now() }, "admin");
  expect(settled.status).toBe("success"); expect(settled.value.accounted).toBe(true);
  const expected = Math.round((initialSpend + settled.value.costUsd) * 1_000_000) / 1_000_000;
  await expect(bar).toHaveAttribute("aria-valuenow", String(expected));
  const snapshot = await call("query", "modelAccounting:snapshot", { organizationId: fixtures.A.organizationId, now: Date.now() }, "admin");
  expect(snapshot.value.estimatedSpendUsd).toBe(expected);
});

test("repository controls persist through real Convex mutations", async ({ page }) => {
  await signIn(page, "A"); await page.goto("/repositories");
  const name = "local-audit-a/example";
  await page.getByRole("button", { name: `Pause reviews for ${name}` }).click();
  await expect(page.getByRole("button", { name: `Resume reviews for ${name}` })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: `Resume reviews for ${name}` }).click();
  await expect(page.getByRole("button", { name: `Pause reviews for ${name}` })).toBeVisible();
  await page.getByRole("combobox", { name: `Inline comment level for ${name}` }).selectOption("quiet");
  await page.reload();
  await expect(page.getByRole("combobox", { name: `Inline comment level for ${name}` })).toHaveValue("quiet");
});

test("authenticated history, reviews, workspace settings and onboarding render the selected workspace", async ({ page }) => {
  await signIn(page, "A");
  for (const [path, title] of [["/history", "What BuildIT found, and what it cost"], ["/reviews", "Review queue"], ["/policies", "Policies"], ["/members", "Members & roles"], ["/setup/install", "Choose repository access"], ["/setup/repository", "Confirm repository policy"], ["/setup/model", "Connect AI only when needed"], ["/setup/health", "Prove the setup boundary"]]) {
    const response = await page.goto(path!);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: title!, exact: true })).toBeVisible();
    await expect(page.getByText(/Application error|Something went wrong|Unknown error/)).toHaveCount(0);
    await expect(page.getByText("Local Audit B", { exact: true })).toHaveCount(0);
  }
  await page.goto("/history");
  await expect(page.getByText("duration not measured", { exact: false })).toBeVisible();
});

test("viewer sees only its own figures and cannot change either workspace budget", async ({ page }) => {
  await signIn(page, "B"); await page.goto("/usage");
  await expect(page.getByRole("progressbar", { name: "Estimated model spend" })).toHaveAttribute("aria-valuenow", "3.75");
  await expect(page.getByText("Only workspace owners can change the monthly limit.")).toBeVisible();
  await expect(page.getByLabel("Monthly model limit · USD")).toHaveCount(0);
  await page.screenshot({ path: "audit/evidence/local-browser-usage-viewer.png", fullPage: true });
  for (const path of ["usage:summarize", "metrics:summarize", "reviewHistory:summary"]) {
    const result = await call("query", path, { organizationId: fixtures.A.organizationId, ...(path === "reviewHistory:summary" ? { since: 0 } : {}) }, "B");
    expect(result.status).toBe("error"); expect(result.errorMessage).toContain("not_found_or_forbidden");
  }
  for (const organizationId of [fixtures.A.organizationId, fixtures.B.organizationId]) {
    const result = await call("mutation", "organizations:updateCapacity", { organizationId, monthlyBudget: 999, requestId: randomUUID() }, "B");
    expect(result.status).toBe("error"); expect(result.errorMessage).toContain("not_found_or_forbidden");
  }
});
