import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("retiring planId and fingerprintKeyVersion", () => {
  it("clears both from every organization and is a no-op the second time", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async ctx => Promise.all([
      ctx.db.insert("organizations", { name: "A", slug: "a", timezone: "UTC", region: "eu-west-1", retentionHours: 24, monthlyBudget: 50, concurrencyLimit: 3, planId: "trial", fingerprintKeyVersion: 1, createdAt: 1 }),
      ctx.db.insert("organizations", { name: "B", slug: "b", timezone: "UTC", region: "eu-west-1", retentionHours: 24, monthlyBudget: 50, concurrencyLimit: 3, createdAt: 1 }),
    ]));
    expect(await t.mutation(internal.organizationFieldMigration.run, {})).toEqual({ cleared: 1, done: true });
    const rows = await t.run(ctx => Promise.all(ids.map(id => ctx.db.get(id))));
    expect(rows.map(row => [row?.planId, row?.fingerprintKeyVersion])).toEqual([[undefined, undefined], [undefined, undefined]]);
    expect(rows[0]?.name).toBe("A");
    expect(await t.mutation(internal.organizationFieldMigration.run, {})).toEqual({ cleared: 0, done: true });
  });
});
