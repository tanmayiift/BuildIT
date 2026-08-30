import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons=cronJobs();
crons.interval("delete expired encrypted artifacts",{minutes:15},internal.artifactCleanupWorker.cleanup,{});
export default crons;
