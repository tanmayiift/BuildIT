import { test as base, chromium, type Browser } from "@playwright/test";

// The signed-in specs run inside a Chrome window that a person signed into themselves, reached over
// its local debugging port. They used to load a saved storage state instead, and that cannot work:
// BuildIT's refresh tokens are single-use (Convex Auth invalidates a session when one is replayed
// after ten seconds), so a saved login survives one refresh at most; GitHub accounts that sign in
// through Google cannot sign in inside a Playwright-launched browser at all; and the saved file
// carried every other site's cookies along with BuildIT's. Here no login is ever written down.
export const test = base.extend<object, { cdpEndpoint: string | undefined; liveBrowser: Browser }>({
  cdpEndpoint: [undefined, { option: true, scope: "worker" }],
  liveBrowser: [async ({ cdpEndpoint }, use) => {
    if (!cdpEndpoint) throw new Error("live_browser_endpoint_required");
    const browser = await chromium.connectOverCDP(cdpEndpoint);
    await use(browser);
    // A connected browser only disconnects here; the person's window stays open.
    await browser.close();
  }, { scope: "worker" }],
  context: async ({ liveBrowser }, use) => {
    const context = liveBrowser.contexts()[0];
    if (!context) throw new Error("live_browser_has_no_signed_in_context");
    await use(context);
  },
  // The person's own context was not created with the config's baseURL, so relative paths are
  // resolved here; the specs keep writing page.goto("/account").
  page: async ({ context, baseURL }, use) => {
    const page = await context.newPage(), goto = page.goto.bind(page);
    page.goto = (url, options) => goto(new URL(url, baseURL).toString(), options);
    await use(page);
    await page.close();
  },
});

export { expect } from "@playwright/test";
