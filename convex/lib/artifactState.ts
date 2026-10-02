import type { Doc } from "../_generated/dataModel";

type Stateful = Pick<Doc<"artifacts">, "storageState">;

// One reading of an artifact's upload state. It used to fall back to the legacy redactionStatus
// while rows migrated; that field is gone, so this is now a plain read kept as the single place
// the question is asked.
export const storageStateOf = (artifact: Stateful) => artifact.storageState;
export const isStored = (artifact: Stateful) => artifact.storageState === "stored";
export const isPending = (artifact: Stateful) => artifact.storageState === "pending";
