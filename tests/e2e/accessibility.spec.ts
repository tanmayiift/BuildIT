import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { renderableRoutes as routes } from "./routes";

for (const route of routes) test(`has no serious accessibility violation: ${route}`, async ({ page }) => {
  await page.goto(route);
  await page.locator("body").waitFor();
  await expect(page.locator("h1").first()).toBeVisible();
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.filter(item => ["serious", "critical"].includes(item.impact ?? "")), JSON.stringify(result.violations, null, 2)).toEqual([]);
});

// The same sweep in the dark scheme. interface-accessibility.test.ts measures token pairs; this
// measures what is painted, so a rule that sets text on a ground nobody paired - or a token used on
// the wrong ground - fails here even when every listed pair passes.
test.describe("in the dark colour scheme", () => {
  test.use({ colorScheme: "dark" });
  for (const route of routes) test(`has no serious accessibility violation in dark mode: ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.locator("body").waitFor();
    await expect(page.locator("h1").first()).toBeVisible();
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(result.violations.filter(item => ["serious", "critical"].includes(item.impact ?? "")), JSON.stringify(result.violations, null, 2)).toEqual([]);
  });
});

for (const route of ["/", "/reviews?tour=1", "/setup/model", "/reviews/22?tour=1", "/reviews/91?tour=1", "/reviews/420?tour=1", "/reviews/418?tour=1&state=cancelled", "/reviews/418?tour=1&state=running", "/reviews/418?tour=1&state=changes", "/reviews/418?tour=1&state=passed", "/reviews/418?tour=1&state=empty", "/reviews/418?tour=1&state=populated"]) test(`matches the release screenshot: ${route}`, async ({ page }) => {
  await page.goto(route);
  await page.locator("body").waitFor();
  await expect(page).toHaveScreenshot(`${route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "landing"}.png`, { fullPage: false, animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.08 });
});

// Renders from connectedDesignFixture, a hardcoded client object - so this proves layout and
// accessibility of the connected state, and nothing about the query that produces it in
// production. The backend half is convex/connectedJourney.test.ts, which drives
// repositoryConnections:current with a signed-in identity against seeded data.
test("connected-state LAYOUT (design fixture, not live data) has no serious accessibility defect and matches its release screenshot", async ({ page }) => {
  test.skip(Boolean(process.env.BUILDIT_E2E_BASE_URL), "The connected design fixture exists only in the local development server.");
  await page.goto("/repositories?tour=1&fixture=connected");
  await expect(page.getByRole("heading", { name: "3 repositories connected" })).toBeVisible();
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.filter(item => ["serious", "critical"].includes(item.impact ?? "")), JSON.stringify(result.violations, null, 2)).toEqual([]);
  await expect(page).toHaveScreenshot("repositories-connected.png", { fullPage: true, animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.03 });
});
