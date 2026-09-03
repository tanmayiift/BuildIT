import { expect, test } from "@playwright/test";
import { sampleReviews } from "../../apps/web/src/app/sample-data";

// The queue advertised nexus/web #22 as "Changes requested" and the detail route rendered
// nexus/api, commit a3f91c2 and the same failed test for every row — so all four statuses opened
// the same page and the repository changed identity between list and detail. In a product whose
// entire claim is an exact pinned commit, losing the commit inside its own demo is the worst
// possible bug to have.
test("every queue row opens the review it advertised", async ({ page }) => {
  await page.goto("/reviews?tour=1");
  for (const review of sampleReviews) {
    const row = page.getByRole("row").filter({ hasText: `${review.repo} #${review.pr}` });
    await expect(row, `${review.repo} #${review.pr} missing from the queue`).toBeVisible();
    await expect(row).toContainText(review.status);
    await expect(row).toContainText(review.commit);
  }
});

for (const review of sampleReviews) {
  test(`detail for ${review.repo} #${review.pr} matches its queue row`, async ({ page }) => {
    await page.goto(`/reviews/${review.pr}?tour=1`);
    // Repository, pull request and the exact commit must survive the navigation.
    await expect(page.locator("body")).toContainText(review.repo);
    await expect(page.locator("body")).toContainText(`#${review.pr}`);
    await expect(page.locator("body")).toContainText(review.commit);
    // ...and no other row's commit may appear on this page.
    for (const other of sampleReviews.filter(item => item.commit !== review.commit)) {
      await expect(page.locator("body"), `${other.commit} leaked onto #${review.pr}`).not.toContainText(other.commit);
    }
  });
}

// Three of four statuses used to render the "changes requested" page, which taught the wrong
// meaning for each of them.
test("the four statuses do not collapse into one page", async ({ page }) => {
  const verdicts = new Set<string>();
  for (const review of sampleReviews) {
    await page.goto(`/reviews/${review.pr}?tour=1`);
    verdicts.add((await page.locator("h1, .verdict-message h2, .verdict-message strong").first().innerText()).trim());
  }
  expect(verdicts.size, `four rows produced ${verdicts.size} distinct verdicts: ${[...verdicts].join(" | ")}`).toBeGreaterThan(1);
});

// The core claim is that a finding names the file, the line and the commit. One example has to
// carry all six pieces or an engineer cannot judge it.
test("one review shows a complete, checkable finding", async ({ page }) => {
  const complete = sampleReviews.find(review => review.finding)!;
  await page.goto(`/reviews/${complete.pr}?tour=1`);
  const finding = complete.finding!;
  const body = page.locator("body");
  await expect(body).toContainText(finding.path);
  await expect(body).toContainText(finding.lines);
  await expect(body).toContainText(complete.commit);
  await expect(body).toContainText("applyDailyLimit");
  await expect(body).toContainText("AssertionError");
  await expect(body).toContainText("auditLog.record");
  await expect(page.getByRole("link", { name: /buildit-public-fixture #19/ })).toHaveAttribute("href", finding.stackedPr.href);
});
