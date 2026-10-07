// What the person who typed an @buildit command is told when it failed before anything could run.
// #137 recorded the code on the delivery and in the log, and the commenter still saw nothing happen:
// in the 6 Oct benchmark, date-fns comments made during a GitHub rate limit simply vanished.
//
// Every sentence is chosen from the code alone - never from the error's text, which can carry
// repository content - and the code itself is shown only once commandFailureCode has reduced it to
// a snake_case token.
//
// undefined means the pull request already says why: review_not_runnable is thrown only after its
// reason was published on the check run. github_app_not_configured has no way to post at all.
const silent = new Set(["review_not_runnable", "github_app_not_configured"]);

// The verb is read against a closed list, so a comment's own words never reach the reply.
const verbs = ["review", "autofix", "ask", "cancel", "dismiss", "help", "pause", "resume"] as const;
export function commandVerb(body: string) {
  const verb = body.match(/@buildit\s+([a-z]+)/i)?.[1]?.toLowerCase();
  return verbs.find(known => known === verb);
}

function reason(code: string): [string, string] {
  const status = Number(code.match(/^(?:pull_request|permission)_lookup_(\d{3})$/)?.[1]);
  if (status === 403 || status === 429) {
    return ["GitHub refused BuildIT's request for this pull request. That usually means the installation's GitHub API limit was reached for the moment.",
      "Comment the command again in a few minutes. If it keeps failing, check in GitHub's settings that the BuildIT app still has access to this repository."];
  }
  if (status === 401 || status === 404) {
    return ["GitHub did not let BuildIT read this pull request.",
      "Check in GitHub's settings that the BuildIT app is still installed on this repository with access to it, then comment again."];
  }
  if (status >= 500) {
    return ["GitHub returned an error while BuildIT was reading this pull request.",
      "Comment the command again. Errors like this from GitHub are usually brief."];
  }
  if (code === "repository_unavailable") {
    return ["This repository is not switched on in a BuildIT workspace, so BuildIT does not act on it.",
      "Someone who manages the workspace can switch it on under Repositories in BuildIT."];
  }
  if (code === "installation_unavailable") {
    return ["The BuildIT app is installed here, but the installation is not linked to an active BuildIT workspace.",
      "Whoever installed it can link it by signing in to BuildIT and finishing setup."];
  }
  if (code === "repository_execution_safety_blocked") {
    return ["BuildIT has switched off running repository code for every workspace for now, so no review can start.",
      "This is BuildIT's switch, not a setting of this repository. Comment the command again later."];
  }
  if (code === "review_runtime_configuration_missing") {
    return ["BuildIT is missing part of its own configuration, so no review can start.",
      "This is BuildIT's problem, not this repository's. Comment the command again later."];
  }
  return ["Something failed inside BuildIT before the command could run.",
    "Comment the command again. If it fails a second time, the reference below tells BuildIT what happened."];
}

export function commandFailureNotice(input: { code: string; verb?: string; at: number }) {
  if (silent.has(input.code)) return undefined;
  const [why, next] = reason(input.code);
  const verb = verbs.find(known => known === input.verb);
  const command = verb ? `\`@buildit ${verb}\`` : "that command";
  const time = new Date(input.at).toISOString().slice(11, 16);
  return [
    `**BuildIT could not carry out ${command}** (${time} UTC).`,
    "",
    `${why} No review was started by it and nothing was charged.`,
    "",
    next,
    "",
    `Reference: \`${input.code}\``,
  ].join("\n");
}
