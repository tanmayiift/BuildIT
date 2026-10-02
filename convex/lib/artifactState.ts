import type { Doc } from "../_generated/dataModel";

type Stateful = Pick<Doc<"artifacts">, "storageState" | "redactionStatus">;

// One reading of an artifact's upload state, so the rename has one place to finish. Rows written
// before storageState existed carry only redactionStatus until artifactStorageMigration moves them;
// the fallback below goes when that field does. A legacy "rejected" maps to neither state, which is
// how every reader treated it before.
export function storageStateOf(artifact: Stateful): "pending" | "stored" | undefined {
  if (artifact.storageState) return artifact.storageState;
  if (artifact.redactionStatus === "redacted") return "stored";
  if (artifact.redactionStatus === "pending") return "pending";
  return undefined;
}
export const isStored = (artifact: Stateful) => storageStateOf(artifact) === "stored";
export const isPending = (artifact: Stateful) => storageStateOf(artifact) === "pending";
