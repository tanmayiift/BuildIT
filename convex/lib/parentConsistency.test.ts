import { describe, expect, it } from "vitest";
import { assertAttemptParent, assertRepositoryParent, assertReviewParent } from "./parentConsistency";

function reader(records: Record<string, unknown>) {
  return { get: async (id: string) => records[id] ?? null } as never;
}

describe("database parent consistency", () => {
  it("accepts a repository only when its installation belongs to the same organization", async () => {
    const db = reader({ repoA: { organizationId: "orgA", installationId: "installA" }, installA: { organizationId: "orgA" } });
    await expect(assertRepositoryParent(db, "orgA" as never, "repoA" as never)).resolves.toMatchObject({ installationId: "installA" });
  });

  it("rejects an installation swapped across organizations", async () => {
    const db = reader({ repoA: { organizationId: "orgA", installationId: "installB" }, installB: { organizationId: "orgB" } });
    await expect(assertRepositoryParent(db, "orgA" as never, "repoA" as never)).rejects.toThrow("parent_scope_mismatch");
  });

  it("rejects a review whose repository is from another organization", async () => {
    const db = reader({ reviewA: { organizationId: "orgA", repositoryId: "repoB" }, repoB: { organizationId: "orgB", installationId: "installB" }, installB: { organizationId: "orgB" } });
    await expect(assertReviewParent(db, "orgA" as never, "reviewA" as never)).rejects.toThrow("parent_scope_mismatch");
  });

  it("rejects an Autofix attempt copied from another review", async () => {
    const db = reader({
      reviewA: { organizationId: "orgA", repositoryId: "repoA" },
      repoA: { organizationId: "orgA", installationId: "installA" }, installA: { organizationId: "orgA" },
      attemptB: { organizationId: "orgA", reviewId: "reviewB" },
    });
    await expect(assertAttemptParent(db, "orgA" as never, "reviewA" as never, "attemptB" as never)).rejects.toThrow("parent_scope_mismatch");
  });
});
