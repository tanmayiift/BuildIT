// Every event a branch of the webhook handler (convex/http.ts) acts on. Anything else is answered and
// dropped before a row is written. The App is subscribed to check_run and check_suite, which nothing
// reads, so every CI check in every connected repository used to arrive, be stored for 30 days and be
// labelled "rejected": 5,564 rows in a month, the largest table in the database, read by nothing.
export const handledWebhookEvents: ReadonlySet<string> = new Set([
  "pull_request_review_thread", "issue_comment", "pull_request", "installation_repositories",
  "repository", "public", "installation", "push",
]);
