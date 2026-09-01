import { expect, test } from "@playwright/test";

test("overview leads through the review queue to exact-commit evidence", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Give your technical lead proof before a pull request is merged." })).toBeVisible();
  await page.getByRole("link", { name: /inspect a sample review/i }).click();
  await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/reviews\/418\?tour=1/),
    page.getByRole("row", { name: /nexus\/api #418/i }).click(),
  ]);
  const pinnedContext = page.getByRole("region", { name: "Pinned review context" });
  await expect(pinnedContext.getByText("a3f91c2", { exact: true })).toBeVisible();
  await expect(pinnedContext.getByText("Full", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
});

for (const [state, heading] of [["cancelled", "Review stopped"], ["running", "BuildIT is reviewing this change"], ["changes", "Changes are needed before merge"], ["passed", "All required checks passed"], ["budget", "Review stopped before the next model step"], ["empty", "A safe decision is not possible yet"], ["populated", "Changes are needed before merge"]] as const) test(`sample review state stays decision-first: ${state}`, async ({ page }) => {
  await page.goto(`/reviews/418?tour=1&state=${state}`);
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  if (state === "cancelled" || state === "empty") {
    await expect(page.getByRole("heading", { name: "No review evidence" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open review queue" })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "How far BuildIT got" })).toHaveCount(0);
  } else {
    await expect(page.getByRole("heading", { name: "How far BuildIT got" })).toBeVisible();
  }
  if (state !== "cancelled" && state !== "empty") await expect(page.getByText("Technical details", { exact: true })).toBeVisible();
  if (state === "budget") {
    await expect(page.getByText("Increase the review budget", { exact: true })).toBeVisible();
    await expect(page.getByText("In progress", { exact: true })).toHaveCount(0);
  }
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
});

test("setup protects the model key and permits skipping it", async ({ page }, testInfo) => {
  await page.goto("/setup/model");
  await expect(page.getByLabel("API key")).toHaveCount(0);
  await expect(page.getByText(/sign in before adding a key/i)).toBeVisible();
  await expect(page.getByText(/separate credential broker/i)).toBeVisible();
  await page.getByText(/github login and model key stay separate/i).click();
  await expect(page.getByText(/every finding requires source or test evidence/i)).toBeVisible();
  await expect(page.getByText(/only a human/i)).toBeVisible();
  await expect(page.getByText("Optional now")).toBeVisible();
  await page.screenshot({path:`.local/ui-evidence/model-key-${testInfo.project.name}.png`,fullPage:true});
});

test("model setup preserves OpenAI and repository scope through GitHub sign-in", async ({ page }) => {
  await page.goto("/setup/model?provider=openai&repository=repo-a");
  await expect(page.locator(".setup-card").getByRole("link", { name: "Sign in with GitHub" })).toHaveAttribute(
    "href",
    "/sign-in?returnTo=%2Fsetup%2Fmodel%3Fprovider%3Dopenai%26repository%3Drepo-a",
  );
});

test("GitHub installation return preserves sign-in and claim context",async({page})=>{await page.goto("/setup/install?installation_id=157557707");const link=page.getByRole("link",{name:"Sign in and return"});await expect(link).toBeVisible();await expect(link).toHaveAttribute("href",/returnTo=.*installation_id%3D157557707/)});

test("GitHub callback failures are visible and recoverable", async ({ page }) => {
  await page.goto("/sign-in?error=OAuthCallbackError&returnTo=%2Fsetup%2Finstall%3Finstallation_id%3D157557707");
  const error = page.locator(".auth-error[role=alert]");
  await expect(error).toContainText("without a verified BuildIT session");
  await expect(error).toContainText("No repository access was granted");
  await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeEnabled();
});

test("production sign-in control reaches identity-only GitHub OAuth", async ({
  page,
}) => {
  test.skip(
    !process.env.BUILDIT_E2E_BASE_URL,
    "Production OAuth proof requires an explicit deployed base URL",
  );
  await page.goto("/sign-in?returnTo=%2Frepositories");
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  await page.waitForURL((url) => url.hostname === "github.com", {
    timeout: 15_000,
  });
  const authorization = new URL(page.url());
  expect(authorization.protocol).toBe("https:");
  const oauthTarget =
    authorization.pathname === "/login"
      ? new URL(authorization.searchParams.get("return_to") ?? "", authorization)
      : authorization;
  expect(oauthTarget.hostname).toBe("github.com");
  expect(oauthTarget.pathname).toBe("/login/oauth/authorize");
  const scopes = (oauthTarget.searchParams.get("scope") ?? "")
    .split(/[ ,]+/)
    .filter(Boolean);
  expect(scopes).not.toContain("repo");
  expect(scopes).not.toContain("public_repo");
  expect(scopes).not.toContain("write:org");
});

test("permission requests explain benefit, limits, retention, and revocation", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByText(/does not give BuildIT access to a repository/i)).toBeVisible();
  await page.goto("/setup/install");
  await expect(page.getByRole("heading", { name: /inspect one exact pull request/i })).toBeVisible();
  await expect(page.getByText(/unselected repositories remain invisible/i)).toBeVisible();
  await expect(page.getByText(/cannot merge, edit workflows/i)).toBeVisible();
  await expect(page.getByText(/deleted within 7 days/i)).toBeVisible();
  await expect(page.getByText(/remove repositories or uninstall BuildIT/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Review access in GitHub" })).toBeVisible();
});

test("production repository control reaches the registered GitHub App", async ({
  page,
}) => {
  test.skip(
    !process.env.BUILDIT_E2E_BASE_URL,
    "Production GitHub App proof requires an explicit deployed base URL",
  );
  await page.goto("/setup/install");
  await page.getByRole("link", { name: "Review access in GitHub" }).click();
  await page.waitForURL((url) => url.hostname === "github.com", {
    timeout: 15_000,
  });
  const github = new URL(page.url());
  expect(github.protocol).toBe("https:");
  const installationTarget =
    github.pathname === "/login"
      ? new URL(github.searchParams.get("return_to") ?? "", github)
      : github;
  expect(installationTarget.hostname).toBe("github.com");
  expect(installationTarget.pathname).toBe(
    "/apps/buildit-agentic-review/installations/new",
  );
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
  await expect(page.getByText("For lean B2B software teams", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Inspect a sample review" })).toHaveAttribute("href", "/reviews?tour=1");
  await expect(page.getByText("Rohan Bhatia")).toHaveCount(0);
  await page.getByRole("link", { name: "Sign in", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeEnabled();
  await expect(page.getByText(/does not give BuildIT access to a repository/i)).toBeVisible();
});

test("public data handling states the current access boundary", async ({ page }) => {
  await page.goto("/data-handling");
  await expect(page.getByRole("heading", { name: "What happens to your data" })).toBeVisible();
  await expect(page.getByText(/sign-in grants identity only/i)).toBeVisible();
  await expect(page.getByText(/does not grant source-code access/i)).toBeVisible();
  await expect(page.getByText(/encrypted artifacts in AWS Ireland/i)).toBeVisible();
  await expect(page.getByText(/isolated checks run in a Vercel Sandbox in Paris, France/i)).toBeVisible();
  await expect(page.getByText(/BuildIT does not promise that AI makes code bug-free/i)).toBeVisible();
  await expect(page.getByText(/still being production-validated/i)).toBeVisible();
  await expect(page.getByText(/review screens remain sample data/i)).toHaveCount(0);
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
  await expect(page.getByText("Not available", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("link", { name: /Linear|Jira/ })).toHaveCount(0);
  await expect(page.locator('a[href="#linear"], a[href="#jira"]')).toHaveCount(0);
  await page.screenshot({ path: `.local/ui-evidence/integrations-${testInfo.project.name}.png`, fullPage: true });
});

test("connected repository controls stay aligned and readable", async ({ page }, testInfo) => {
  test.skip(Boolean(process.env.BUILDIT_E2E_BASE_URL), "The connected design fixture exists only in the local development server.");
  const browserErrors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error" && /Hydration failed|hydration mismatch|Uncaught Error/i.test(message.text())) browserErrors.push(message.text());
  });
  await page.goto("/repositories?tour=1&fixture=connected");
  await expect(page.getByRole("heading", { name: "3 repositories connected" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Repository policy for northstar/api" }).getByText("Reviews active")).toBeVisible();
  await expect(page.getByRole("article", { name: "Repository policy for northstar/worker" }).getByText("Reviews paused")).toBeVisible();
  await expect(page.getByLabel("Autofix delivery for northstar/api")).toHaveCSS("min-height", "44px");
  await expect(page.getByRole("button", { name: "Pause reviews for northstar/api" })).toHaveCSS("min-height", "44px");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(browserErrors).toEqual([]);
  await page.screenshot({ path: `.local/ui-evidence/repositories-connected-${testInfo.project.name}.png`, fullPage: true, scale: "css" });
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
