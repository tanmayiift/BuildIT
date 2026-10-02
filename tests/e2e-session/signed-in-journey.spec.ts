import { expect, test } from "@playwright/test";
import { reviewStatusLabels } from "../../apps/web/src/app/review-status";

// Runs as the operator's real signed-in session (playwright.session.config.ts). The first test only
// reads. The other two change state and are opt-in, each naming the variable that enables it: one
// saves a model key, the other spends sandbox time and a model call, so both run only against a
// BuildIT-owned workspace and repository.
const login = process.env.BUILDIT_E2E_SESSION_LOGIN;

test("a signed-in member reads their own workspace, not the tour", async ({ page }) => {
  if (!login) throw new Error("session_login_required");
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Your GitHub identity" })).toBeVisible();
  await expect(page.locator("body")).toContainText(login);
  for (const route of ["/overview", "/repositories", "/reviews"]) {
    await page.goto(route);
    await expect(page.getByText("Sample tour · no live workspace data")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Sign in to open your workspace" })).toHaveCount(0);
  }
  await page.goto("/repositories");
  await expect(page.locator(".preview-label")).toHaveText("Connected");
  await page.goto("/reviews");
  await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();
});

test("a saved model key comes back masked to its last four characters", async ({ page }) => {
  const key = process.env.BUILDIT_E2E_SESSION_MODEL_KEY;
  test.skip(!key, "opt-in: set BUILDIT_E2E_SESSION_MODEL_KEY to a key for a BuildIT-owned workspace");
  await page.goto("/setup/model");
  await page.locator("#provider-api-key").fill(key!);
  await page.getByRole("button", { name: "Validate and save key" }).click();
  await expect(page.getByLabel(`Key ending in ${key!.slice(-4)}`)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("body")).not.toContainText(key!);
});

test("prepare, consent and start a review, then read its verdict", async ({ page }) => {
  const pr = process.env.BUILDIT_E2E_SESSION_REVIEW_PR;
  test.skip(!pr, "opt-in: set BUILDIT_E2E_SESSION_REVIEW_PR to a pull request on a BuildIT-owned repository; this spends sandbox time and a model call");
  test.setTimeout(20 * 60_000);
  await page.goto("/reviews");
  const repository = process.env.BUILDIT_E2E_SESSION_REVIEW_REPO;
  if (repository) await page.getByLabel("Repository").selectOption({ label: repository });
  await page.getByLabel("Pull request number").fill(pr!);
  await page.getByRole("button", { name: "Preview review access" }).click();
  await page.getByRole("button", { name: "Consent and start review" }).click({ timeout: 60_000 });
  await page.waitForURL(/\/reviews\/[^/?#]+$/, { timeout: 60_000 });
  const terminal = ["checks_passed", "changes_requested", "inconclusive", "delivered", "failed_after_bounds", "blocked", "cancelled", "budget_exhausted", "platform_failed"] as const;
  const labels = new RegExp(terminal.map(status => reviewStatusLabels[status]).join("|"));
  await expect(page.locator("main")).toContainText(labels, { timeout: 18 * 60_000 });
});
