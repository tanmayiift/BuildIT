import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons=cronJobs();
crons.interval("delete expired encrypted artifacts",{minutes:15},internal.artifactCleanupWorker.cleanup,{});
crons.interval("requeue stuck artifact deletions",{hours:1},internal.artifactCleanupWorker.sweepTerminal,{});
crons.interval("reconcile stuck and expired reviews",{minutes:10},internal.reconcileWorker.sweep,{});
crons.interval("emit source-free operational snapshot",{minutes:5},internal.telemetrySnapshotWorker.emit,{});
export default crons;
