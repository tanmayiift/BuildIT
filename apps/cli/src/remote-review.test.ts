import { describe, expect, it, vi } from "vitest";
import {
  remoteStatus,
  requestRemoteAutofix,
  requestRemoteCommand,
  watchRemoteStatus,
  type RemoteExec,
} from "./remote-review.js";

function fixture(
  responses: Array<{ code: number; stdout: string; stderr?: string }>,
) {
  const calls: Array<[string, string[]]> = [],
    emit = vi.fn(),
    exec: RemoteExec = vi.fn(async (file, args) => {
      calls.push([file, args]);
      const response = responses.shift();
      if (!response) throw new Error("unexpected_command");
      return {
        code: response.code,
        stdout: response.stdout,
        stderr: response.stderr ?? "",
      };
    });
  return { calls, emit, exec };
}

describe("remote GitHub CLI review commands", () => {
  it("posts only the fixed review command through the existing gh login", async () => {
    const f = fixture([
      { code: 0, stdout: JSON.stringify({ nameWithOwner: "acme/service" }) },
      {
        code: 0,
        stdout: JSON.stringify({
          url: "https://github.com/acme/service/pull/7",
          headRefOid: "a".repeat(40),
        }),
      },
      {
        code: 0,
        stdout: JSON.stringify({
          html_url: "https://github.com/acme/service/issues/7#comment",
        }),
      },
    ]);
    await expect(
      requestRemoteCommand({
        pr: "7",
        command: "review",
        emit: f.emit,
        exec: f.exec,
      }),
    ).resolves.toBe(0);
    expect(f.calls).toEqual([
      ["gh", ["repo", "view", "--json", "nameWithOwner"]],
      [
        "gh",
        [
          "pr",
          "view",
          "7",
          "--repo",
          "acme/service",
          "--json",
          "url,headRefOid",
        ],
      ],
      [
        "gh",
        [
          "api",
          "--method",
          "POST",
          "repos/acme/service/issues/7/comments",
          "-f",
          "body=@buildit review",
        ],
      ],
    ]);
    expect(JSON.stringify(f.calls)).not.toMatch(/token|authorization/i);
    expect(f.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "remote_requested",
        data: expect.objectContaining({
          command: "review",
          prNumber: 7,
          pinnedHead: "a".repeat(40),
          prUrl: "https://github.com/acme/service/pull/7",
        }),
      }),
    );
  });

  it("pins an explicitly selected provider into the GitHub command", async () => {
    const f = fixture([
      {
        code: 0,
        stdout: JSON.stringify({
          url: "https://github.com/acme/service/pull/7",
          headRefOid: "a".repeat(40),
        }),
      },
      {
        code: 0,
        stdout: JSON.stringify({
          html_url: "https://github.com/acme/service/issues/7#comment",
        }),
      },
    ]);
    await requestRemoteCommand({
      pr: "7",
      repo: "acme/service",
      command: "review",
      provider: "anthropic",
      budgetLimit: 2,
      emit: f.emit,
      exec: f.exec,
    });
    expect(f.calls[1]?.[1]).toContain(
      "body=@buildit review provider=anthropic budget=2",
    );
    expect(f.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: "anthropic",
          budgetLimit: 2,
        }),
      }),
    );
  });

  it("posts cancel through the same repository-scoped path", async () => {
    const f = fixture([
      { code: 0, stdout: JSON.stringify({ nameWithOwner: "acme/service" }) },
      {
        code: 0,
        stdout: JSON.stringify({
          url: "https://github.com/acme/service/pull/8",
          headRefOid: "b".repeat(40),
        }),
      },
      { code: 0, stdout: "{}" },
    ]);
    await requestRemoteCommand({
      pr: "8",
      command: "cancel",
      emit: f.emit,
      exec: f.exec,
    });
    expect(f.calls[2]?.[1]).toContain("body=@buildit cancel");
  });

  it("accepts a validated explicit repository without querying the current directory", async () => {
    const f = fixture([
      {
        code: 0,
        stdout: JSON.stringify({
          url: "https://github.com/acme/service/pull/8",
          headRefOid: "b".repeat(40),
        }),
      },
      { code: 0, stdout: "{}" },
    ]);
    await requestRemoteCommand({
      pr: "8",
      repo: "acme/service",
      command: "cancel",
      emit: f.emit,
      exec: f.exec,
    });
    expect(f.calls).toEqual([
      [
        "gh",
        [
          "pr",
          "view",
          "8",
          "--repo",
          "acme/service",
          "--json",
          "url,headRefOid",
        ],
      ],
      [
        "gh",
        [
          "api",
          "--method",
          "POST",
          "repos/acme/service/issues/8/comments",
          "-f",
          "body=@buildit cancel",
        ],
      ],
    ]);
  });

  it("does not post when GitHub cannot provide an exact PR head", async () => {
    const f = fixture([
      { code: 0, stdout: JSON.stringify({ nameWithOwner: "acme/service" }) },
      {
        code: 0,
        stdout: JSON.stringify({
          url: "https://github.com/acme/service/pull/8",
          headRefOid: "not-a-commit",
        }),
      },
    ]);
    await expect(
      requestRemoteCommand({
        pr: "8",
        command: "review",
        emit: f.emit,
        exec: f.exec,
      }),
    ).rejects.toThrow("github_pull_request_invalid");
    expect(f.calls).toHaveLength(2);
    expect(f.calls.some(([, args]) => args.includes("POST"))).toBe(false);
  });

  it("maps GitHub Check states to stable exit codes", async () => {
    for (const [check, code, status] of [
      [
        {
          name: "BuildIT / review",
          status: "COMPLETED",
          conclusion: "SUCCESS",
        },
        0,
        "passed",
      ],
      [
        {
          name: "BuildIT / review",
          status: "COMPLETED",
          conclusion: "FAILURE",
        },
        2,
        "action_required",
      ],
      [
        { name: "BuildIT / review", status: "IN_PROGRESS", conclusion: "" },
        3,
        "running",
      ],
      [
        {
          name: "BuildIT / review",
          status: "COMPLETED",
          conclusion: "NEUTRAL",
        },
        3,
        "inconclusive",
      ],
    ] as const) {
      const f = fixture([
        { code: 0, stdout: JSON.stringify({ nameWithOwner: "acme/service" }) },
        {
          code: 0,
          stdout: JSON.stringify({
            url: "https://github.com/acme/service/pull/9",
            headRefOid: "a".repeat(40),
            statusCheckRollup: [check],
          }),
        },
      ]);
      await expect(
        remoteStatus({ pr: "9", emit: f.emit, exec: f.exec }),
      ).resolves.toBe(code);
      expect(f.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "remote_status",
          data: expect.objectContaining({ status }),
        }),
      );
    }
  });

  it("includes the exact-commit BuildIT App report without another model call", async () => {
    const headSha = "a".repeat(40),
      f = fixture([
        {
          code: 0,
          stdout: JSON.stringify({
            url: "https://github.com/acme/service/pull/9",
            headRefOid: headSha,
            statusCheckRollup: [
              {
                name: "BuildIT / review",
                status: "COMPLETED",
                conclusion: "FAILURE",
              },
            ],
          }),
        },
        {
          code: 0,
          stdout: JSON.stringify({
            check_runs: [
              {
                name: "BuildIT / review",
                status: "completed",
                conclusion: "failure",
                head_sha: headSha,
                app: { slug: "buildit-agentic-review" },
                output: {
                  title: "Changes requested",
                  summary:
                    "### Findings\n- `src/tax.js:4`: tax only the excess above 100",
                },
              },
            ],
          }),
        },
      ]);
    await expect(
      remoteStatus({ pr: "9", repo: "acme/service", emit: f.emit, exec: f.exec }),
    ).resolves.toBe(2);
    expect(f.calls[1]).toEqual([
      "gh",
      [
        "api",
        `repos/acme/service/commits/${headSha}/check-runs`,
        "-H",
        "Accept: application/vnd.github+json",
      ],
    ]);
    expect(f.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "remote_status",
        data: expect.objectContaining({
          report: {
            title: "Changes requested",
            summary:
              "### Findings\n- `src/tax.js:4`: tax only the excess above 100",
          },
        }),
      }),
    );
  });

  it("omits foreign, stale, unsupported, malformed, or unsafe check reports", async () => {
    const headSha = "a".repeat(40),
      base = {
        name: "BuildIT / review",
        head_sha: headSha,
        app: { slug: "buildit-agentic-review" },
        output: { title: "Changes requested", summary: "safe" },
      },
      rejected = [
        { ...base, app: { slug: "foreign-app" } },
        { ...base, head_sha: "b".repeat(40) },
        { ...base, name: "Foreign check" },
        { ...base, output: { title: "\u001b[31munsafe", summary: "safe" } },
      ];
    for (const checkRun of rejected) {
      const f = fixture([
        {
          code: 0,
          stdout: JSON.stringify({
            url: "https://github.com/acme/service/pull/9",
            headRefOid: headSha,
            statusCheckRollup: [
              {
                name: "BuildIT / review",
                status: "COMPLETED",
                conclusion: "FAILURE",
              },
            ],
          }),
        },
        { code: 0, stdout: JSON.stringify({ check_runs: [checkRun] }) },
      ]);
      await remoteStatus({
        pr: "9",
        repo: "acme/service",
        emit: f.emit,
        exec: f.exec,
      });
      expect(f.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ report: expect.anything() }),
        }),
      );
    }
    const malformed = fixture([
      {
        code: 0,
        stdout: JSON.stringify({
          url: "https://github.com/acme/service/pull/9",
          headRefOid: headSha,
          statusCheckRollup: [
            {
              name: "BuildIT / review",
              status: "COMPLETED",
              conclusion: "FAILURE",
            },
          ],
        }),
      },
      { code: 0, stdout: "not-json" },
    ]);
    await remoteStatus({
      pr: "9",
      repo: "acme/service",
      emit: malformed.emit,
      exec: malformed.exec,
    });
    expect(malformed.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ report: expect.anything() }),
      }),
    );
  });

  it("watches GitHub Checks until a terminal result and can be resumed", async () => {
    const f = fixture([
        {
          code: 0,
          stdout: JSON.stringify({
            url: "https://github.com/acme/service/pull/9",
            headRefOid: "a".repeat(40),
            statusCheckRollup: [
              {
                name: "BuildIT / review",
                status: "IN_PROGRESS",
                conclusion: "",
              },
            ],
          }),
        },
        {
          code: 0,
          stdout: JSON.stringify({
            url: "https://github.com/acme/service/pull/9",
            headRefOid: "a".repeat(40),
            statusCheckRollup: [
              {
                name: "BuildIT / review",
                status: "COMPLETED",
                conclusion: "SUCCESS",
              },
            ],
          }),
        },
      ]),
      wait = vi.fn(async () => undefined);
    await expect(
      watchRemoteStatus({
        pr: "9",
        repo: "acme/service",
        intervalSeconds: "1",
        timeoutSeconds: "10",
        emit: f.emit,
        exec: f.exec,
        wait,
      }),
    ).resolves.toBe(0);
    expect(wait).toHaveBeenCalledOnce();
    expect(f.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "remote_watch_started",
        data: expect.objectContaining({
          resume: expect.stringContaining("Rerun"),
        }),
      }),
    );
    expect(f.emit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "remote_status",
        data: expect.objectContaining({ status: "passed" }),
      }),
    );
  });

  it("rejects unbounded watch timing before polling GitHub", async () => {
    const noCall = vi.fn<RemoteExec>();
    await expect(
      watchRemoteStatus({
        pr: "9",
        repo: "acme/service",
        intervalSeconds: "0",
        emit: vi.fn(),
        exec: noCall,
      }),
    ).rejects.toThrow("invalid_watch_interval");
    await expect(
      watchRemoteStatus({
        pr: "9",
        repo: "acme/service",
        timeoutSeconds: "3601",
        emit: vi.fn(),
        exec: noCall,
      }),
    ).rejects.toThrow("invalid_watch_timeout");
    expect(noCall).not.toHaveBeenCalled();
  });

  it("fails before a write for invalid PRs or repository names", async () => {
    const noCall = vi.fn<RemoteExec>();
    await expect(
      requestRemoteCommand({
        pr: "../7",
        command: "review",
        emit: vi.fn(),
        exec: noCall,
      }),
    ).rejects.toThrow("invalid_pull_request_number");
    expect(noCall).not.toHaveBeenCalled();
    const f = fixture([
      {
        code: 0,
        stdout: JSON.stringify({ nameWithOwner: "acme/service/escape" }),
      },
    ]);
    await expect(
      requestRemoteCommand({
        pr: "7",
        command: "review",
        emit: f.emit,
        exec: f.exec,
      }),
    ).rejects.toThrow("github_repository_invalid");
    expect(f.calls).toHaveLength(1);
  });

  it("requires explicit stacked-PR consent before requesting Autofix", async () => {
    const noCall = vi.fn<RemoteExec>();
    await expect(
      requestRemoteAutofix({
        pr: "7",
        repo: "acme/service",
        confirmed: false,
        emit: vi.fn(),
        exec: noCall,
      }),
    ).rejects.toThrow("autofix_confirmation_required");
    expect(noCall).not.toHaveBeenCalled();
    const f = fixture([
      {
        code: 0,
        stdout: JSON.stringify({
          url: "https://github.com/acme/service/pull/7",
          headRefOid: "a".repeat(40),
        }),
      },
      {
        code: 0,
        stdout: JSON.stringify({
          html_url: "https://github.com/acme/service/issues/7#comment",
        }),
      },
    ]);
    await expect(
      requestRemoteAutofix({
        pr: "7",
        repo: "acme/service",
        confirmed: true,
        emit: f.emit,
        exec: f.exec,
      }),
    ).resolves.toBe(0);
    expect(f.calls[1]).toEqual([
      "gh",
      [
        "api",
        "--method",
        "POST",
        "repos/acme/service/issues/7/comments",
        "-f",
        "body=@buildit autofix stacked",
      ],
    ]);
    expect(f.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "remote_requested",
        data: expect.objectContaining({
          command: "autofix_stacked",
          pinnedHead: "a".repeat(40),
          roundLimit: 3,
          delivery: "stacked_pr",
          humanMergeRequired: true,
        }),
      }),
    );
  });
});
