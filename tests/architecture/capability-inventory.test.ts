import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../.."),
  inventory = JSON.parse(readFileSync(resolve(root, "docs/validation/capability-inventory.json"), "utf8")) as {
    states: string[];
    capabilities: Array<{ id: string; requirements: string[]; state: string; entrypoints: string[]; tests: string[]; dependency: string; gap: string }>;
  },
  spec = readFileSync(resolve(root, "docs/BuildIT-complete-product-spec-v1.3.md"), "utf8"),
  required = [...new Set(spec.match(/REQ-\d{3}/g) ?? [])].sort();

function expands(expression: string) {
  const [first, last] = expression.split("-").map(Number);
  return last === undefined ? [first!] : Array.from({ length: last - first! + 1 }, (_, index) => first! + index);
}

describe("capability inventory", () => {
  it("maps every specification requirement exactly once", () => {
    const mapped = new Map<string, string[]>();
    for (const capability of inventory.capabilities) for (const range of capability.requirements) {
      for (const number of expands(range)) {
        const requirement = `REQ-${String(number).padStart(3, "0")}`;
        if (!required.includes(requirement)) continue;
        mapped.set(requirement, [...(mapped.get(requirement) ?? []), capability.id]);
      }
    }
    expect([...mapped.keys()].sort()).toEqual(required);
    expect([...mapped.values()].filter(capabilities => capabilities.length !== 1)).toEqual([]);
  });

  it("links every capability to real implementation and test evidence", () => {
    for (const capability of inventory.capabilities) {
      expect(inventory.states).toContain(capability.state);
      expect(capability.entrypoints.length).toBeGreaterThan(0);
      expect(capability.tests.length).toBeGreaterThan(0);
      expect(capability.dependency.length).toBeGreaterThan(10);
      expect(capability.gap.length).toBeGreaterThan(10);
      for (const path of [...capability.entrypoints, ...capability.tests]) expect(existsSync(resolve(root, path)), `${capability.id}: ${path}`).toBe(true);
    }
  });

  it("does not call externally blocked capabilities implemented", () => {
    for (const capability of inventory.capabilities.filter(item => /live|production|external|human|deployment/i.test(`${item.dependency} ${item.gap}`))) {
      if (capability.state === "implemented_local") expect(capability.gap).toMatch(/production.*cannot be claimed|production.*externally gated/i);
    }
  });
});
