import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Every workflow action is pinned to a full commit SHA, and nothing enforced it. A tag is a moving
// pointer the upstream owner can repoint at any commit, so `uses: owner/action@v4` grants whoever
// controls that repository the ability to run their code against this one's secrets, on push, at a
// moment of their choosing - including after a maintainer account is compromised. That is the
// supply-chain shape the pinning convention exists to close, and a convention nobody checks is one
// commit away from being over.
//
// The gate was written once, on a branch, and never landed; it was found in a stale worktree while
// pruning. This is it, rewritten against the workflows as they are now.
const workflowDirectory = fileURLToPath(new URL("../../.github/workflows", import.meta.url));
const workflows = readdirSync(workflowDirectory).filter(name => /\.ya?ml$/.test(name));

// 40 hex characters. GitHub resolves a short SHA, so a truncated one is still mutable in the sense
// that matters: it is not a complete identity, and an abbreviation can become ambiguous as the
// upstream history grows.
const pinnedSha = /^[0-9a-f]{40}$/;

type Reference = { workflow: string; line: number; uses: string };

function actionReferences(): Reference[] {
  const found: Reference[] = [];
  for (const workflow of workflows) {
    const lines = readFileSync(`${workflowDirectory}/${workflow}`, "utf8").split("\n");
    lines.forEach((text, index) => {
      const match = /^\s*(?:-\s*)?uses:\s*(\S+)/.exec(text);
      if (match) found.push({ workflow, line: index + 1, uses: match[1]! });
    });
  }
  return found;
}

describe("CI action pinning", () => {
  it("finds the workflows, so an empty sweep cannot pass as a clean one", () => {
    expect(workflows.length).toBeGreaterThan(0);
    expect(actionReferences().length).toBeGreaterThan(0);
  });

  it("pins every third-party action to a full commit SHA rather than a tag", () => {
    const unpinned = actionReferences().filter(reference => {
      // A local composite action lives in this repository and moves only when this repository does.
      if (reference.uses.startsWith("./")) return false;
      const ref = reference.uses.split("@")[1];
      return !ref || !pinnedSha.test(ref);
    });
    expect(unpinned.map(item => `${item.workflow}:${item.line} ${item.uses}`)).toEqual([]);
  });

  it("keeps the human-readable version beside each pin", () => {
    // A bare SHA is safe and unreadable: nobody can tell whether actions/cache@55cc834 is a year out
    // of date. Dependabot writes the `# vX.Y.Z` comment when it bumps a pin, so requiring it keeps
    // the pins reviewable and keeps a hand-edited pin from losing the only clue to its age.
    const missing = actionReferences().filter(reference => {
      if (reference.uses.startsWith("./")) return false;
      const lines = readFileSync(`${workflowDirectory}/${reference.workflow}`, "utf8").split("\n");
      return !/#\s*v?\d/.test(lines[reference.line - 1] ?? "");
    });
    expect(missing.map(item => `${item.workflow}:${item.line} ${item.uses}`)).toEqual([]);
  });
});
