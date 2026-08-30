import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const routes = ["/", "/sign-in", "/data-handling", "/repositories?tour=1", "/reviews?tour=1", "/reviews/418?tour=1", "/setup/model"];

for (const route of routes) test(`has no serious accessibility violation: ${route}`, async ({ page }) => {
  await page.goto(route);
  await page.locator("body").waitFor();
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.filter(item => ["serious", "critical"].includes(item.impact ?? "")), JSON.stringify(result.violations, null, 2)).toEqual([]);
});

for (const route of ["/", "/reviews?tour=1", "/setup/model"]) test(`matches the release screenshot: ${route}`, async ({ page }) => {
  await page.goto(route);
  await page.locator("body").waitFor();
  await expect(page).toHaveScreenshot(`${route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "landing"}.png`, { fullPage: true, animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.02 });
});
