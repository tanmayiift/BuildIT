import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { decisionEmail } from "../../packages/operations/src/email.js";

const message = decisionEmail({
  recipient: {
    email: "reviewer@example.com",
    organizationId: "org_northstar",
    userId: "user_reviewer",
    verifiedAt: Date.UTC(2026, 8, 1),
    consentedAt: Date.UTC(2026, 8, 1),
  },
  status: "changes_requested",
  repository: "northstar/payments",
  prNumber: 42,
  commit: "0123456789abcdef0123456789abcdef01234567",
  url: "https://buildit-agentic-review.vercel.app/reviews/review_example",
  githubUrl: "https://github.com/northstar/payments/pull/42",
  dedupeKey: "review:example:changes_requested",
});

test("decision email is readable, source-free, and visually stable", async ({ page }) => {
  await page.setContent(message.html);
  await expect(page.getByRole("heading", { name: "Changes need review" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next action" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open BuildIT review/ })).toHaveAttribute("href", /buildit-agentic-review\.vercel\.app/);
  await expect(page.getByRole("link", { name: /Open northstar\/payments pull request/ })).toHaveAttribute("href", "https://github.com/northstar/payments/pull/42");
  await expect(page.locator("img, script, iframe")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("console.log");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.filter(item => ["serious", "critical"].includes(item.impact ?? "")), JSON.stringify(result.violations, null, 2)).toEqual([]);
  await expect(page).toHaveScreenshot("decision-email-changes-requested.png", { fullPage: true, animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.03 });
});
