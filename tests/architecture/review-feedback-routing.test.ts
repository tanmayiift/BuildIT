import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The concern this pins: a review's result must reach the repository owner and the person who
// raised the pull request, never a fixed operator inbox. BuildIT sends no email of its own — the
// result leaves through two GitHub API writes, and GitHub's own participant fan-out addresses it.
// A hardcoded address anywhere on that path would silently redirect every tenant's feedback.

const sourceRoots = ["convex", "packages", "apps/web/src", "scripts"];
const skipDirectories = new Set(["node_modules", "dist", ".next", "_generated", "coverage", "test", "__tests__"]);
const sourceExtensions = [".ts", ".tsx", ".mjs", ".js"];

function sourceFiles(root: string, files: string[] = []) {
  let entries: string[];
  try { entries = readdirSync(root); } catch { return files; }
  for (const entry of entries) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      if (!skipDirectories.has(entry)) sourceFiles(path, files);
      continue;
    }
    if (!sourceExtensions.some(extension => entry.endsWith(extension))) continue;
    if (entry.includes(".test.") || entry.includes(".spec.")) continue;
    files.push(path);
  }
  return files;
}

const productionSources = sourceRoots.flatMap(root => sourceFiles(root));

describe("review feedback routing", () => {
  it("scans a real set of production sources", () => {
    expect(productionSources.length).toBeGreaterThan(100);
  });

  // Grafana's operator contact point is configured in Grafana Cloud, not in application code,
  // so no address belongs in any file that can run inside a tenant's review.
  it("carries no hardcoded destination address on any tenant code path", () => {
    const address = /[a-z0-9._%+-]+@[a-z0-9.-]+\.(?:com|org|net|dev|io|co|in)\b/gi;
    // users.noreply.github.com is the git *author* on an Autofix commit, not a destination.
    const allowed = /(?:@buildit\/|example\.com|users\.noreply\.github\.com|@types\/|@aws-sdk\/)/i;
    const offenders: string[] = [];
    for (const path of productionSources) {
      for (const match of readFileSync(path, "utf8").match(address) ?? []) {
        if (!allowed.test(match)) offenders.push(`${path}: ${match}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // packages/operations/src/email.ts is a complete tenant-scoped pipeline with no transport and
  // no caller. If a transport is ever wired in, it must resolve recipients per tenant rather than
  // reintroducing a fixed address, so pin that the resolver is still the only entry point.
  it("resolves any future email recipient from tenant ids alone", () => {
    const notifications = readFileSync("convex/notifications.ts", "utf8");
    expect(notifications).toContain("resolveDecisionRecipient");
    // The arguments are ids and a clock, never an address supplied by a caller.
    expect(notifications).toMatch(/resolveDecisionRecipient = internalQuery\(\{\s*args: \{ organizationId: v\.id\("organizations"\), repositoryId: v\.id\("repositories"\), userId: v\.string\(\), now: v\.number\(\) \}/);
    expect(notifications).not.toMatch(/args:[^}]*email: v\.string\(\)/);
  });

  // The two writes that actually deliver a review result. Both are addressed by repository and
  // pull request, so GitHub notifies that repository's owner and that PR's author.
  it("delivers a review result only through the pull request it reviewed", () => {
    const publication = readFileSync("convex/reviewPublicationWorker.ts", "utf8");
    expect(publication).toContain("upsertCheckRun");
    // Addressed by pull request number, so GitHub fans the comment out to that PR's participants.
    expect(publication).toMatch(/upsertIssueComment\(\{ prNumber: scope\.prNumber/);
    expect(publication).not.toMatch(/sendEmail|smtp|sendgrid|resend|postmark/i);
  });
});
