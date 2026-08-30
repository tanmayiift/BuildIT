import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Every customer-facing route that can be rendered without production OAuth.
// Workspace routes use the explicit sample tour so the test covers their full
// information layout without pretending sample data belongs to a signed-in user.
const routes = [
  "/",
  "/sign-in",
  "/account",
  "/data-handling",
  "/reviews?tour=1",
  "/reviews/418?tour=1",
  "/repositories?tour=1",
  "/metrics?tour=1",
  "/usage?tour=1",
  "/integrations?tour=1",
  "/policies?tour=1",
  "/members?tour=1",
  "/audit?tour=1",
  "/setup/install",
  "/setup/repository",
  "/setup/model",
  "/setup/health",
  "/not-a-real-route",
];

for (const route of routes) test(`has no serious accessibility violation: ${route}`, async ({ page }) => {
  await page.goto(route);
  await page.locator("body").waitFor();
  await expect(page.locator("h1").first()).toBeVisible();
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.filter(item => ["serious", "critical"].includes(item.impact ?? "")), JSON.stringify(result.violations, null, 2)).toEqual([]);
});

for (const route of ["/", "/reviews?tour=1", "/setup/model"]) test(`matches the release screenshot: ${route}`, async ({ page }) => {
  await page.goto(route);
  await page.locator("body").waitFor();
  await expect(page).toHaveScreenshot(`${route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "landing"}.png`, { fullPage: false, animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.08 });
});
