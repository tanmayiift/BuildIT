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

// The events the production GitHub App is subscribed to, read from
// https://api.github.com/apps/buildit-agentic-review after subscribing repository, public and
// pull_request_review_thread on 2 October 2026 and confirming a live delivery of each.
//
// installation and installation_repositories are deliberately in neither set below. GitHub delivers
// installation lifecycle events to an App without subscription - the settings page offers no
// checkbox for them, and an `installation` delivery with action new_permissions_accepted arrived
// while that subscription change was being saved. The first version of this file claimed
// installation_repositories could never fire, which was wrong. The true statement is narrower, and
// was the original finding: it is not sent when a repository changes visibility.
//
// This list is the other half of the same bug, and it is the half nothing could see. A handler in
// http.ts for an event the App does not subscribe to is indistinguishable, in code and in every test,
// from a handler that works - GitHub simply never calls it. Four handlers were in that state:
// installation_repositories (so adding a repository in GitHub never reached BuildIT by webhook,
// despite the comment in http.ts explaining that it should), pull_request_review_thread (so
// findingFeedbackWorker.observe has never received a single resolved thread, which is the entire
// learning signal), and repository/public, added to make repositories.visibility converge and inert
// the moment they shipped.
//
// Event subscriptions live in the App's settings and have no REST endpoint, so this cannot be fixed
// from the repository. What the repository can do is refuse to pretend: a handler listed here is
// claimed to be live, and a handler absent from it is named as dead with what its absence costs.
const subscribedEvents = new Set([
  "check_run", "check_suite", "issue_comment", "pull_request", "push",
  "repository", "public", "pull_request_review_thread",
]);

// Delivered to every GitHub App without subscription, so not dead and not opt-in.
const alwaysDeliveredEvents = new Set(["installation", "installation_repositories", "installation_target", "meta"]);

// Empty, and that is the point: every handler in http.ts is reachable. A handler added for an event
// the App does not subscribe to must be recorded here with what its absence costs, because in code
// and in every other test it is indistinguishable from one that works.
const unsubscribedHandlers: Record<string, string> = {};

describe("every webhook event BuildIT listens for", () => {
  // installation_repositories is not sent on a visibility change. GitHub sends `repository` with
  // action privatized/publicized, and `public` when a private repository is opened up. Without
  // these two, `repositories.visibility` could never converge after the grant, which is how private
  // repositories stayed stored as public and reached the unauthenticated evidence list.
  it("listens for the events that change a repository's visibility", () => {
    for (const event of ["repository", "public"]) {
      expect(http, `${event} must re-sync the installation, or visibility can never converge`)
        .toContain(`event === "${event}"`);
    }
  });

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

  // The assertion that would have caught all four. Every handled event is either one the App
  // subscribes to, or one written down here as dead with the consequence stated. Adding a handler
  // for an unsubscribed event now fails until somebody either subscribes the App or records why the
  // handler is being written anyway.
  it("names every handler the App cannot currently deliver to", () => {
    const handled = [...new Set([...http.matchAll(/event === "([a-z_]+)"/g)].map(match => match[1]!))];
    const undeclared = handled.filter(event => !subscribedEvents.has(event)
      && !alwaysDeliveredEvents.has(event) && !(event in unsubscribedHandlers));
    expect(undeclared, "a handler for an unsubscribed event looks identical to a working one - declare it or subscribe the App").toEqual([]);
  });

  it("does not claim a handler is dead once the App subscribes to it", () => {
    // The inverse, so the list shrinks as subscriptions are added instead of rotting into folklore.
    const stale = Object.keys(unsubscribedHandlers)
      .filter(event => subscribedEvents.has(event) || alwaysDeliveredEvents.has(event));
    expect(stale, "these events are subscribed now and must leave unsubscribedHandlers").toEqual([]);
  });
});
