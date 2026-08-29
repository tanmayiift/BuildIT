import { execFileSync } from "node:child_process";

const tracked = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
}).split("\0").filter(Boolean);

const forbidden = [
  {
    reason: "environment or credential file",
    matches: (path) =>
      /(^|\/)\.env(?:\.|$)/.test(path) && !/(^|\/)\.env\.example$/.test(path),
  },
  {
    reason: "private key or certificate bundle",
    matches: (path) => /\.(?:pem|key|p12|pfx)$/i.test(path),
  },
  {
    reason: "private execution plan",
    matches: (path) =>
      path === "PLAN.md" || path === "docs/plan-BuildIT.md",
  },
  {
    reason: "raw review artifact or copied production source",
    matches: (path) =>
      /(^|\/)(?:raw-artifacts|customer-source|production-source)(\/|$)/i.test(path),
  },
  {
    reason: "operating-system metadata",
    matches: (path) => /(^|\/)\.DS_Store$/.test(path),
  },
];

const violations = tracked.flatMap((path) =>
  forbidden
    .filter(({ matches }) => matches(path))
    .map(({ reason }) => `${path}: ${reason}`),
);

if (violations.length > 0) {
  console.error("Unsafe files are tracked by Git:\n" + violations.join("\n"));
  process.exit(1);
}

console.log(`Tracked-file safety check passed (${tracked.length} files inspected).`);
