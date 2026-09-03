import { expect, test } from "@playwright/test";

// No test measured a hit area before this one. The only 44px assertions were three spot checks on
// named elements and one regex against the stylesheet, so a reviewer sweeping the site found the
// "Trust boundary" control at 81x15 and "Menu" at 68x40 - and the four sub-44 rules behind them
// had been there all along.
//
// WCAG 2.5.5 asks for 44x44. This measures what is rendered, not what is declared, because padding
// is what actually decides whether a thumb lands on the control.
const routes = ["/", "/sign-in", "/data-handling", "/pricing", "/sandbox", "/setup/install", "/setup/repository", "/setup/model", "/setup/health", "/reviews?tour=1", "/repositories?tour=1", "/usage?tour=1"];
const minimum = 44;

for (const route of routes) test(`every interactive element is at least ${minimum}x${minimum}: ${route}`, async ({ page }) => {
  await page.goto(route);
  await page.locator("body").waitFor();
  const undersized = await page.evaluate(size => {
    const selector = "a[href], button, summary, select, input:not([type=hidden]), [role=button], [tabindex]:not([tabindex='-1'])";
    return [...document.querySelectorAll(selector)]
      .filter(element => element.getClientRects().length > 0)
      .map(element => {
        const box = element.getBoundingClientRect();
        const label = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40) || element.tagName.toLowerCase();
        return { label, width: Math.round(box.width), height: Math.round(box.height) };
      })
      .filter(item => item.width < size || item.height < size);
  }, minimum);
  expect(undersized, `undersized controls on ${route}: ${JSON.stringify(undersized)}`).toEqual([]);
});
