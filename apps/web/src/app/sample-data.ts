export const sampleReviews = [
  { status: "Changes requested", tone: "danger", repo: "nexus/web", pr: 22, title: "Update landing page typography", commit: "b2c8f41", coverage: "2 / 2", signal: "1 high", owner: "Author", age: "12m" },
  { status: "Failed after bounds", tone: "danger", repo: "nexus/api", pr: 418, title: "Refactor user authentication", commit: "d9f2e1a", coverage: "3 / 4", signal: "1 critical", owner: "You", age: "45m" },
  { status: "Inconclusive", tone: "warning", repo: "nexus/core", pr: 91, title: "Add support for webhooks", commit: "f1a2b3c", coverage: "0 / 1", signal: "1 medium", owner: "You", age: "1h" },
  { status: "Running", tone: "running", repo: "nexus/api", pr: 420, title: "Fix database race", commit: "e5a1d2c", coverage: "Stage 3 / 4", signal: "Checks", owner: "You", age: "2m" },
];

export const efficacy = { reviewed: 45, suggestions: 18, implemented: 9, effectiveLoc: 126, regressions: 12 };
