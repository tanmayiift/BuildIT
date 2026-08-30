import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { redactCliOutput, runLocalReview, type CliEvent, type Exec } from "./local-review";

describe("BuildIT local CLI", () => {
  it("pins a clean commit, previews only allowlisted scripts, and returns stable JSON events", async () => {
    const root = await mkdtemp(join(tmpdir(), "buildit-cli-"));
    try {
      await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest", lint: "eslint ." } }));
      await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'");
      const events: CliEvent[] = [], calls: Array<[string, string[]]> = [];
      const exec: Exec = async (file, args) => {
        calls.push([file, args]); const joined = args.join(" ");
        if (file === "git" && joined === "rev-parse --show-toplevel") return { code: 0, stdout: `${root}\n`, stderr: "" };
        if (file === "git" && joined === "status --porcelain") return { code: 0, stdout: "", stderr: "" };
        if (file === "git" && joined === "rev-parse HEAD") return { code: 0, stdout: `${"a".repeat(40)}\n`, stderr: "" };
        if (file === "git" && joined === "merge-base HEAD origin/HEAD") return { code: 0, stdout: `${"b".repeat(40)}\n`, stderr: "" };
        if (file === "git" && ["diff", "ls-files"].includes(args[0]!)) return { code: 0, stdout: "", stderr: "" };
        return { code: 0, stdout: "ok", stderr: "" };
      };
      await expect(runLocalReview({ cwd: root, emit: item => events.push(item), exec })).resolves.toMatchObject({ status: "checks_passed", exitCode: 0 });
      expect(events.map(item => item.type)).toEqual(["session", "command_plan", "check_started", "check_completed", "check_started", "check_completed", "check_completed", "review_completed"]);
      expect(calls.filter(([file]) => file !== "git")).toEqual([["pnpm", ["run", "test"]], ["pnpm", ["run", "lint"]]]);
      expect(JSON.stringify(events)).toContain(`"headSha":"${"a".repeat(40)}"`);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("includes dirty scoped files, pins --base, ignores untrusted policy, and never writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "buildit-cli-dirty-")), scope = join(root, "packages", "billing");
    try {
      await mkdir(scope, { recursive: true });
      await writeFile(join(scope, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
      await writeFile(join(root, "package-lock.json"), "{}");
      const events: CliEvent[] = [], calls: Array<[string, string[]]> = [];
      const exec: Exec = async (file, args) => {
        calls.push([file, args]); const joined = args.join(" ");
        if (joined === "rev-parse --show-toplevel") return { code: 0, stdout: `${root}\n`, stderr: "" };
        if (joined === "status --porcelain") return { code: 0, stdout: " M packages/billing/a.ts\n", stderr: "" };
        if (joined === "rev-parse HEAD") return { code: 0, stdout: `${"a".repeat(40)}\n`, stderr: "" };
        if (joined === "rev-parse --verify release/1^{commit}") return { code: 0, stdout: `${"b".repeat(40)}\n`, stderr: "" };
        if (args[0] === "diff") return { code: 0, stdout: "packages/billing/a.ts\0packages/billing/.buildit/config.json\0", stderr: "" };
        if (args[0] === "ls-files") return { code: 0, stdout: "packages/billing/new.ts\0", stderr: "" };
        return { code: 0, stdout: "ok", stderr: "" };
      };
      await expect(runLocalReview({ cwd: root, directory: "packages/billing", baseRef: "release/1", emit: item => events.push(item), exec })).resolves.toMatchObject({ exitCode: 0 });
      expect(events[0]?.data).toMatchObject({ dirty: true, scope: "packages/billing", baseSha: "b".repeat(40), changedFiles: ["packages/billing/.buildit/config.json", "packages/billing/a.ts", "packages/billing/new.ts"], workingTreeIncluded: true });
      expect(events[1]?.data).toMatchObject({ configuration: "committed_only" });
      expect(String(events[1]?.data.warning)).toContain("Working-tree .buildit changes are not trusted");
      expect(calls.some(([, args]) => args.includes("--verify"))).toBe(true);
      expect(calls.filter(([file]) => file !== "git").map(([file]) => file)).toEqual(["npm"]);
      expect(events.at(-1)?.data).toMatchObject({ workingTreeModified: false });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("redacts key-shaped command evidence", () => {
    const value = ["AI", "za", "SyA", "1234567890", "1234567890", "1234567890"].join("");
    expect(redactCliOutput(`failed with ${value}`)).toBe("failed with [REDACTED]");
  });

  it("rejects option-shaped and range base refs before resolving them", async () => {
    for (const baseRef of ["--upload-pack=evil", "main..attacker"]) {
      const exec: Exec = async (_file, args) => {
        if (args.join(" ") === "rev-parse --show-toplevel") return { code: 0, stdout: "/fixture\n", stderr: "" };
        if (args.join(" ") === "status --porcelain") return { code: 0, stdout: "", stderr: "" };
        return { code: 0, stdout: `${"a".repeat(40)}\n`, stderr: "" };
      };
      await expect(runLocalReview({ cwd: "/fixture", baseRef, emit: () => {}, exec })).rejects.toThrow("invalid_base_ref");
    }
  });
});
