import { expect, test } from "@playwright/test";

const fixture = {
  "user-a": { ownOrganization: process.env.BUILDIT_E2E_USER_A_ORG, foreignOrganization: process.env.BUILDIT_E2E_USER_B_ORG, ownMarker: process.env.BUILDIT_E2E_USER_A_MARKER, foreignMarker: process.env.BUILDIT_E2E_USER_B_MARKER, ownReview: process.env.BUILDIT_E2E_USER_A_REVIEW, foreignReview: process.env.BUILDIT_E2E_USER_B_REVIEW },
  "user-b": { ownOrganization: process.env.BUILDIT_E2E_USER_B_ORG, foreignOrganization: process.env.BUILDIT_E2E_USER_A_ORG, ownMarker: process.env.BUILDIT_E2E_USER_B_MARKER, foreignMarker: process.env.BUILDIT_E2E_USER_A_MARKER, ownReview: process.env.BUILDIT_E2E_USER_B_REVIEW, foreignReview: process.env.BUILDIT_E2E_USER_A_REVIEW },
} as const;

test("each real identity sees only its own tenant surfaces", async ({ page }, info) => {
  const values = fixture[info.project.name as keyof typeof fixture];
  if (Object.values(values).some(value => !value)) throw new Error("two_user_fixture_metadata_required");
  for (const route of ["/account", "/repositories", "/reviews", "/metrics", "/usage", "/setup/model", "/audit-log"]) {
    await page.goto(route);
    await expect(page.locator("body")).toContainText(values.ownOrganization!);
    await expect(page.locator("body")).not.toContainText(values.foreignOrganization!);
    await expect(page.locator("body")).not.toContainText(values.foreignMarker!);
  }
  await page.goto(values.ownReview!);
  await expect(page.locator("body")).toContainText(values.ownMarker!);
  await page.goto(values.foreignReview!);
  await expect(page.locator("body")).not.toContainText(values.foreignMarker!);
  await expect(page.locator("body")).not.toContainText(values.foreignOrganization!);
});
