import { expect, test } from "@playwright/test";

test("overview leads through the review queue to exact-commit evidence", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Engineering review, with proof" })).toBeVisible();
  await page.getByRole("link", { name: /open review queue/i }).click();
  await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();
  await page.getByText("nexus/api #418").click();
  const pinnedContext = page.getByRole("region", { name: "Pinned review context" });
  await expect(pinnedContext.getByText("a3f91c2", { exact: true })).toBeVisible();
  await expect(pinnedContext.getByText("main @ 7b2e004", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
});

test("setup protects the model key and permits skipping it", async ({ page }, testInfo) => {
  await page.goto("/setup/model");
  await expect(page.getByLabel("API key")).toHaveCount(0);
  await expect(page.getByText(/sign in before adding a key/i)).toBeVisible();
  await expect(page.getByText(/separate credential broker/i)).toBeVisible();
  await expect(page.getByText("Optional now")).toBeVisible();
  await page.screenshot({path:`.local/ui-evidence/model-key-${testInfo.project.name}.png`,fullPage:true});
});

test("GitHub installation return preserves sign-in and claim context",async({page})=>{await page.goto("/setup/install?installation_id=157557707");const link=page.getByRole("link",{name:"Sign in and return"});await expect(link).toBeVisible();await expect(link).toHaveAttribute("href",/returnTo=.*installation_id%3D157557707/)});

test("GitHub callback failures are visible and recoverable", async ({ page }) => {
  await page.goto("/sign-in?error=OAuthCallbackError&returnTo=%2Fsetup%2Finstall%3Finstallation_id%3D157557707");
  const error = page.locator(".auth-error[role=alert]");
  await expect(error).toContainText("without a verified BuildIT session");
  await expect(error).toContainText("No repository access was granted");
  await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeEnabled();
});

test("navigation exposes all promised product areas", async ({ page }) => {
  await page.goto("/");
  const menu = page.getByText("Menu", { exact: true });
  if (await menu.isVisible()) await menu.click();
  for (const name of ["Review queue", "Repositories", "Metrics", "Usage", "Integrations", "Policies", "Members", "Audit log"]) {
    await expect(page.getByRole("link", { name, exact: true }).last()).toBeVisible();
  }
});

test("preview never impersonates a signed-in customer", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Preview", { exact: true })).toBeVisible();
  await expect(page.getByText(/sample workspace · product tour/i)).toBeVisible();
  await expect(page.getByText("Rohan Bhatia")).toHaveCount(0);
  await page.getByRole("link", { name: "Sign in", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeEnabled();
  await expect(page.getByText(/does not give BuildIT access to a repository/i)).toBeVisible();
});

test("public data handling states the current access boundary", async ({ page }) => {
  await page.goto("/data-handling");
  await expect(page.getByRole("heading", { name: "What happens to your data" })).toBeVisible();
  await expect(page.getByText(/signing in shares your approved GitHub identity/i)).toBeVisible();
  await expect(page.getByText(/does not grant repository access/i)).toBeVisible();
});

test("repository and integration screens use truthful live connection states", async ({ page }, testInfo) => {
  await page.goto("/repositories?tour=1");
  await expect(page.getByRole("heading", { name: "Repositories" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in to see repository access" })).toBeVisible();
  await expect(page.getByText("Not connected", { exact: true })).toHaveCount(0);
  await expect(page.getByText("None", { exact: true })).toHaveCount(0);
  const signIn = page.getByRole("main").getByRole("link", { name: "Sign in with GitHub" });
  await expect(signIn).toHaveClass(/action-primary/);
  await expect(signIn).toHaveCSS("min-height", "44px");
  await expect(page.getByRole("link", { name: "How isolation works" })).toHaveClass(/action-tertiary/);
  await page.screenshot({ path: `.local/ui-evidence/repositories-${testInfo.project.name}.png`, fullPage: true });
  await page.goto("/integrations?tour=1");
  const github = page.getByRole("heading", { name: "GitHub", exact: true }).locator("..");
  await expect(github.getByText("Setup needed")).toBeVisible();
  const githubAction = github.getByRole("link", { name: "Sign in with GitHub" });
  await expect(githubAction).toBeVisible();
  await expect(githubAction).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.screenshot({ path: `.local/ui-evidence/integrations-${testInfo.project.name}.png`, fullPage: true });
});

test("workspace routes require authentication unless sample tour is explicit", async ({ page }) => {
  await page.goto("/repositories");
  await expect(page.getByRole("heading", { name: "Sign in to open your workspace" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Repositories" })).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("link", { name: "Sign in with GitHub" })).toHaveAttribute("href", "/sign-in?returnTo=%2Frepositories");

  await page.getByRole("link", { name: "View the sample tour" }).click();
  await expect(page).toHaveURL(/\/repositories\?tour=1$/);
  await expect(page.getByRole("heading", { name: "Repositories" })).toBeVisible();
  await expect(page.getByText("Sample tour · no live workspace data", { exact: true })).toBeVisible();
});

test("the complete signed-out journey reports access and safety honestly", async ({ page }, testInfo) => {
  await page.goto("/");
  const readiness = page.getByRole("region", { name: "Explore freely. Connect only when an action needs it." });
  await expect(readiness.getByText("Save your workspaces and preferences")).toBeVisible();
  await expect(readiness.getByText("GitHub identity verified")).toHaveCount(0);

  await page.goto("/setup/health");
  await expect(page.getByText("GitHub identity").locator("..").getByText("Required")).toBeVisible();
  await expect(page.getByText("Repository execution").locator("..").getByText("Safety blocked")).toBeVisible();
  const repositoryHealth = page.locator(".health-list > div").filter({ hasText: "Repository installation" });
  const sandboxHealth = page.locator(".health-list > div").filter({ hasText: "Sandbox boundary" });
  await expect(repositoryHealth.getByText("required", { exact: true })).toBeVisible();
  await expect(sandboxHealth.getByText("blocked", { exact: true })).toBeVisible();
  await page.screenshot({ path: `.local/ui-evidence/setup-health-${testInfo.project.name}.png`, fullPage: true });

  await page.goto("/members");
  await expect(page.getByRole("heading", { name: "Sign in to open your workspace" })).toBeVisible();
  const signIn = page.getByRole("main").getByRole("link", { name: "Sign in with GitHub" });
  await expect(signIn).toHaveAttribute("href", "/sign-in?returnTo=%2Fmembers");
  await page.screenshot({ path: `.local/ui-evidence/members-${testInfo.project.name}.png`, fullPage: true });

  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
});
