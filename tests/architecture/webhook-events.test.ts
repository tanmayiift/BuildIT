import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The feedback signal was first written to listen for a "reaction" event. GitHub emits no such
// webhook - not for repositories and not for Apps - so it could never have fired, and nothing in
// the test suite would ever have said so. It was caught by reacting to a real comment in
// production and watching no delivery arrive.
//
// This pins every event name against the list GitHub actually sends, so the next one that gets
// invented fails here instead of failing silently for weeks.
const githubWebhookEvents = new Set([
  "check_run", "check_suite", "commit_comment", "create", "delete", "deployment", "deployment_status",
  "fork", "gollum", "installation", "installation_repositories", "issue_comment", "issues", "label",
  "member", "membership", "milestone", "organization", "page_build", "project", "project_card",
  "project_column", "public", "pull_request", "pull_request_review", "pull_request_review_comment",
  "pull_request_review_thread", "push", "release", "repository", "repository_dispatch", "status",
  "team", "team_add", "watch", "workflow_dispatch", "workflow_job", "workflow_run", "merge_group",
]);

describe("every webhook event BuildIT listens for", () => {
  const http = readFileSync(join(import.meta.dirname, "../../convex/http.ts"), "utf8");

  it("is an event GitHub actually sends", () => {
    for (const match of http.match(/event === "([a-z_]+)"/g) ?? []) {
      const name = match.replace(/.*"([a-z_]+)"$/, "$1");
      expect(githubWebhookEvents).toContain(name);
    }
  });

  it("does not listen for reactions, which emit no webhook", () => {
    expect(http).not.toContain('event === "reaction"');
  });
});
