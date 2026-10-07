import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons=cronJobs();
crons.interval("delete expired encrypted artifacts",{minutes:15},internal.artifactCleanupWorker.cleanup,{});
crons.interval("requeue stuck artifact deletions",{hours:1},internal.artifactCleanupWorker.sweepTerminal,{});
crons.interval("reconcile stuck and expired reviews",{minutes:10},internal.reconcileWorker.sweep,{});
// The sweep schedules this itself the moment it reaps a job, because a sandbox bills by the minute.
// This tick is the backstop for the rows whose broker call failed that time.
crons.interval("release sandboxes from reaped execution jobs",{minutes:10},internal.sandboxReclaimWorker.reclaim,{});
crons.interval("emit source-free operational snapshot",{minutes:5},internal.telemetrySnapshotWorker.emit,{});
crons.interval("purge deleted workspace connection metadata",{hours:1},internal.trackerOAuthData.sweepDeletedOrganizations,{});
// Keeps the visibility confirmation behind the public evidence list inside publicProof's freshness
// window. Four times the window's length apart, so a single missed run never ages a row out.
crons.interval("confirm visibility of published evidence repositories",{hours:6},internal.githubInstallations.refreshEvidenceVisibility,{});
crons.interval("summarise the public proof page",{hours:6},internal.publicProof.refreshSummary,{});
crons.interval("delete spent sign-in tokens and rows nothing reads",{hours:24},internal.retention.sweep,{});
// Review history older than 30 days, and everything it owns (retention.ts).
crons.interval("delete review history older than 30 days",{hours:24},internal.retention.expireReviews,{});
export default crons;
