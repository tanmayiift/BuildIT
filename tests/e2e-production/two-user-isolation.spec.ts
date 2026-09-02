import { expect, test } from "@playwright/test";

const fixture = {
  "user-a": { ownLogin: process.env.BUILDIT_E2E_USER_A_LOGIN, foreignLogin: process.env.BUILDIT_E2E_USER_B_LOGIN, ownOrganization: process.env.BUILDIT_E2E_USER_A_ORG, foreignOrganization: process.env.BUILDIT_E2E_USER_B_ORG, ownMarker: process.env.BUILDIT_E2E_USER_A_MARKER, foreignMarker: process.env.BUILDIT_E2E_USER_B_MARKER, ownReview: process.env.BUILDIT_E2E_USER_A_REVIEW, foreignReview: process.env.BUILDIT_E2E_USER_B_REVIEW },
  "user-b": { ownLogin: process.env.BUILDIT_E2E_USER_B_LOGIN, foreignLogin: process.env.BUILDIT_E2E_USER_A_LOGIN, ownOrganization: process.env.BUILDIT_E2E_USER_B_ORG, foreignOrganization: process.env.BUILDIT_E2E_USER_A_ORG, ownMarker: process.env.BUILDIT_E2E_USER_B_MARKER, foreignMarker: process.env.BUILDIT_E2E_USER_A_MARKER, ownReview: process.env.BUILDIT_E2E_USER_B_REVIEW, foreignReview: process.env.BUILDIT_E2E_USER_A_REVIEW },
} as const;

test("each real identity sees only its own tenant surfaces", async ({ page }, info) => {
  const values = fixture[info.project.name as keyof typeof fixture];
  if (Object.values(values).some(value => !value)) throw new Error("two_user_fixture_metadata_required");
  await page.goto("/account");
  await expect(page.locator("body")).toContainText(values.ownLogin!);
  await expect(page.locator("body")).not.toContainText(values.foreignLogin!);
  for (const route of ["/repositories", "/reviews", "/setup/model"]) {
    await page.goto(route);
    await expect(page.locator("body")).toContainText(values.ownOrganization!);
    await expect(page.locator("body")).not.toContainText(values.foreignOrganization!);
    await expect(page.locator("body")).not.toContainText(values.foreignMarker!);
  }
  for (const route of ["/metrics", "/usage", "/audit"]) {
    await page.goto(route);
    // The banner label is "Connected" in the DOM; .preview-label uppercases it in CSS only,
    // and toContainText reads textContent, so asserting "CONNECTED" could never pass.
    await expect(page.locator("body")).toContainText("Connected");
    await expect(page.locator("body")).not.toContainText(values.foreignOrganization!);
    await expect(page.locator("body")).not.toContainText(values.foreignMarker!);
  }
  await page.goto("/repositories");
  await expect(page.locator("body")).toContainText(values.ownMarker!);
  await page.goto(values.ownReview!);
  await expect(page.locator("body")).toContainText(values.ownMarker!);
  await page.goto(values.foreignReview!);
  await expect(page.locator("body")).not.toContainText(values.foreignMarker!);
  await expect(page.locator("body")).not.toContainText(values.foreignOrganization!);
});
