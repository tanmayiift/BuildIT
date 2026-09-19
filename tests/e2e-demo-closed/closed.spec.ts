import { expect, test } from "@playwright/test";

test("the site is coherent with the open scan closed", async ({ page }) => {
  // 1. The landing hero offers no control that cannot work. The panel posts to a route that is
  //    now 404, so rendering it would put a guaranteed error in the first thing a stranger sees.
  await page.goto("/");
  await expect(page.locator(".landing-try")).toBeVisible();
  await expect(page.locator(".landing-try .scan-panel")).toHaveCount(0);
  await expect(page.locator(".landing-try-closed")).toBeVisible();

  // 2. No nav entry points at the closed demo, in either the header or the footer - one array
  //    feeds both, so a miss here would be two dead links.
  await expect(page.getByRole("link", { name: "Try a scan" })).toHaveCount(0);

  // 3. The route still answers. Dropping it from publicRoutes would 404 it and contradict the
  //    proxy's own route table, which three unit suites assert agrees with itself.
  const response = await page.goto("/scan");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(".scan-panel")).toHaveCount(0);

  // 4. And it is not a dead end: the journey's own call to action still reaches setup.
  await page.getByRole("link", { name: "Connect a GitHub repository" }).click();
  await page.waitForURL(/\/setup\/install$/);

  // 5. The endpoint itself refuses, with a sentence rather than an identifier.
  const scan = await page.request.post("/api/scan", { data: { files: [{ path: "a.ts", content: "const a = 1;" }] } });
  expect(scan.status()).toBe(404);
  expect(await scan.json()).toEqual({ error: "demo_closed" });
});
