import { spawn } from "node:child_process";
import type { CliEvent } from "./local-review.js";

type Result = { code: number; stdout: string; stderr: string };
export type RemoteExec = (file: string, args: string[]) => Promise<Result>;
export type RemoteProvider = "anthropic" | "openai" | "gemini";
export type RemoteBudget = 1 | 2 | 3 | 5;
const execute: RemoteExec = (file, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, {
        env: {
          HOME: process.env.HOME,
          PATH: process.env.PATH,
          GH_HOST: process.env.GH_HOST,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }),
      stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });
const event = (
  type: CliEvent["type"],
  data: Record<string, unknown>,
): CliEvent => ({ version: 1, type, at: new Date().toISOString(), data });
function validPr(value: string | undefined) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 2_147_483_647)
    throw new Error("invalid_pull_request_number");
  return number;
}
function repository(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)
  )
    throw new Error("github_repository_invalid");
  return value;
}
async function currentRepository(exec: RemoteExec, requested?: string) {
  if (requested) return repository(requested);
  const result = await exec("gh", ["repo", "view", "--json", "nameWithOwner"]);
  if (result.code !== 0)
    throw new Error("github_login_or_repository_unavailable");
  return repository(
    (JSON.parse(result.stdout) as { nameWithOwner?: unknown }).nameWithOwner,
  );
}

export async function requestRemoteCommand(input: {
  pr: string | undefined;
  repo?: string | undefined;
  command: "review" | "cancel";
  provider?: RemoteProvider | undefined;
  budgetLimit?: RemoteBudget | undefined;
  emit: (item: CliEvent) => void;
  exec?: RemoteExec;
}) {
  const exec = input.exec ?? execute,
    pr = validPr(input.pr),
    repo = await currentRepository(exec, input.repo),
    body = `@buildit ${input.command}${input.provider ? ` provider=${input.provider}` : ""}${input.budgetLimit ? ` budget=${input.budgetLimit}` : ""}`;
  if (input.command === "cancel" && (input.provider || input.budgetLimit))
    throw new Error("review_options_not_allowed_for_cancel");
  const preview = await exec("gh", [
    "pr",
    "view",
    String(pr),
    "--repo",
    repo,
    "--json",
    "url,headRefOid",
  ]);
  if (preview.code !== 0) throw new Error("github_status_failed");
  const pull = JSON.parse(preview.stdout) as {
    url?: unknown;
    headRefOid?: unknown;
  };
  if (
    typeof pull.headRefOid !== "string" ||
    !/^[0-9a-f]{40}$/.test(pull.headRefOid)
  )
    throw new Error("github_pull_request_invalid");
  const result = await exec("gh", [
    "api",
    "--method",
    "POST",
    "repos/" + repo + "/issues/" + pr + "/comments",
    "-f",
    "body=" + body,
  ]);
  if (result.code !== 0) throw new Error("github_command_failed");
  const response = JSON.parse(result.stdout) as { html_url?: unknown };
  input.emit(
    event("remote_requested", {
      repository: repo,
      prNumber: pr,
      command: input.command,
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.budgetLimit ? { budgetLimit: input.budgetLimit } : {}),
      pinnedHead: pull.headRefOid,
      prUrl: pull.url,
      commentUrl:
        typeof response.html_url === "string" ? response.html_url : undefined,
      authorization: "GitHub collaborator permission is rechecked by BuildIT",
    }),
  );
  return 0;
}

export async function remoteStatus(input: {
  pr: string | undefined;
  repo?: string | undefined;
  emit: (item: CliEvent) => void;
  exec?: RemoteExec;
}) {
  const exec = input.exec ?? execute,
    pr = validPr(input.pr),
    repo = await currentRepository(exec, input.repo);
  const result = await exec("gh", [
    "pr",
    "view",
    String(pr),
    "--repo",
    repo,
    "--json",
    "url,headRefOid,statusCheckRollup",
  ]);
  if (result.code !== 0) throw new Error("github_status_failed");
  const response = JSON.parse(result.stdout) as {
      url?: unknown;
      headRefOid?: unknown;
      statusCheckRollup?: Array<{
        name?: unknown;
        status?: unknown;
        conclusion?: unknown;
        detailsUrl?: unknown;
      }>;
    },
    checks = (response.statusCheckRollup ?? []).filter((check) =>
      [
        "BuildIT / review",
        "BuildIT / Autofix",
        "BuildIT / validated candidate",
      ].includes(String(check.name)),
    );
  const status = !checks.length
    ? "not_started"
    : checks.some((check) => check.status !== "COMPLETED")
      ? "running"
      : checks.every((check) => String(check.conclusion) === "SUCCESS")
        ? "passed"
        : checks.some((check) => String(check.conclusion) === "NEUTRAL")
          ? "inconclusive"
          : "action_required";
  input.emit(
    event("remote_status", {
      repository: repo,
      prNumber: pr,
      prUrl: response.url,
      headSha: response.headRefOid,
      status,
      checks,
    }),
  );
  return status === "passed" ? 0 : status === "action_required" ? 2 : 3;
}

function boundedSeconds(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  code: string,
) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum)
    throw new Error(code);
  return parsed;
}

export async function watchRemoteStatus(input: {
  pr: string | undefined;
  repo?: string | undefined;
  intervalSeconds?: string | undefined;
  timeoutSeconds?: string | undefined;
  emit: (item: CliEvent) => void;
  exec?: RemoteExec;
  wait?: (milliseconds: number) => Promise<void>;
}) {
  const exec = input.exec ?? execute,
    pr = validPr(input.pr),
    repo = await currentRepository(exec, input.repo),
    intervalSeconds = boundedSeconds(
      input.intervalSeconds,
      5,
      1,
      60,
      "invalid_watch_interval",
    ),
    timeoutSeconds = boundedSeconds(
      input.timeoutSeconds,
      900,
      1,
      3_600,
      "invalid_watch_timeout",
    ),
    wait =
      input.wait ??
      ((milliseconds: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, milliseconds))),
    startedAt = Date.now();
  input.emit(
    event("remote_watch_started", {
      repository: repo,
      prNumber: pr,
      intervalSeconds,
      timeoutSeconds,
      resume:
        "Rerun the same status --watch command; GitHub Checks are the source of truth",
    }),
  );
  while (true) {
    const exitCode = await remoteStatus({
      pr: String(pr),
      repo,
      emit: input.emit,
      exec,
    });
    if (exitCode !== 3) return exitCode;
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= timeoutSeconds * 1_000) {
      input.emit(
        event("remote_watch_timeout", {
          repository: repo,
          prNumber: pr,
          timeoutSeconds,
          status: "still_running_or_not_started",
        }),
      );
      return 3;
    }
    await wait(
      Math.min(intervalSeconds * 1_000, timeoutSeconds * 1_000 - elapsedMs),
    );
  }
}

export async function requestRemoteAutofix(input: {
  pr: string | undefined;
  repo?: string | undefined;
  confirmed: boolean;
  provider?: RemoteProvider | undefined;
  budgetLimit?: RemoteBudget | undefined;
  emit: (item: CliEvent) => void;
  exec?: RemoteExec;
}) {
  if (!input.confirmed) throw new Error("autofix_confirmation_required");
  const exec = input.exec ?? execute,
    pr = validPr(input.pr),
    repo = await currentRepository(exec, input.repo);
  const preview = await exec("gh", [
    "pr",
    "view",
    String(pr),
    "--repo",
    repo,
    "--json",
    "url,headRefOid",
  ]);
  if (preview.code !== 0) throw new Error("github_status_failed");
  const pull = JSON.parse(preview.stdout) as {
    url?: unknown;
    headRefOid?: unknown;
  };
  if (
    typeof pull.headRefOid !== "string" ||
    !/^[0-9a-f]{40}$/.test(pull.headRefOid)
  )
    throw new Error("github_pull_request_invalid");
  const result = await exec("gh", [
    "api",
    "--method",
    "POST",
    "repos/" + repo + "/issues/" + pr + "/comments",
    "-f",
    `body=@buildit autofix stacked${input.provider ? ` provider=${input.provider}` : ""}${input.budgetLimit ? ` budget=${input.budgetLimit}` : ""}`,
  ]);
  if (result.code !== 0) throw new Error("github_command_failed");
  const response = JSON.parse(result.stdout) as { html_url?: unknown };
  input.emit(
    event("remote_requested", {
      repository: repo,
      prNumber: pr,
      command: "autofix_stacked",
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.budgetLimit ? { budgetLimit: input.budgetLimit } : {}),
      pinnedHead: pull.headRefOid,
      prUrl: pull.url,
      commentUrl:
        typeof response.html_url === "string" ? response.html_url : undefined,
      roundLimit: 3,
      delivery: "stacked_pr",
      humanMergeRequired: true,
      authorization:
        "GitHub write permission and the current PR head are rechecked by BuildIT before any write",
    }),
  );
  return 0;
}
