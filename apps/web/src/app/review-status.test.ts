import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { reviewStatusLabel, reviewStatusLabels, reviewStatuses } from "./review-status";
import { auditActionLabel, auditResultLabel, incompleteReasonLabel, incompleteReasonLabels } from "./workspace-labels";

// Six vocabularies existed for one eighteen-value enum - the queue, the review detail, its
// presentation helper, /history, and two inside /proof that contradicted each other on the same page -
// and seventeen of the eighteen statuses had conflicting labels across them. platform_failed alone had
// four names. These assertions keep it to one.
const root = fileURLToPath(new URL("../../../..", import.meta.url));
const appDir = fileURLToPath(new URL(".", import.meta.url));
const validators = readFileSync(join(root, "convex/validators.ts"), "utf8");
const enumBlock = validators.slice(validators.indexOf("export const reviewStatus = v.union("), validators.indexOf(");", validators.indexOf("export const reviewStatus = v.union(")));
const declared = [...enumBlock.matchAll(/v\.literal\("([a-z_]+)"\)/g)].map(match => match[1]!);

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("one name per review status", () => {
  it("names exactly the statuses convex/validators.ts declares", () => {
    expect(declared.length, "the enum must be found, or this asserts nothing").toBeGreaterThan(10);
    expect([...reviewStatuses].sort()).toEqual([...declared].sort());
  });

  it("names every status in words, with no code fragment left in the name", () => {
    for (const status of declared) {
      const label = reviewStatusLabel(status);
      expect(label, `${status} has no label`).toBeTruthy();
      expect(label, `${status} leaks a code fragment`).not.toContain("_");
    }
    // Deliberately NOT asserted: that a label differs from its code with the underscores swapped for
    // spaces. That check was written and removed. It rejected "Checks passed" - chosen over "Ready for
    // you" precisely because BuildIT never decides a merge - for coinciding with checks_passed, and it
    // cannot tell a mechanical rewrite from a deliberate name that happens to match. What actually
    // produced "validating final" was a fallback that rewrote the code at render time. The two tests
    // that guard against that are this file's exhaustiveness check, which means no fallback ever runs,
    // and its ban on .replace(/_/g in the pages that used to do it.
  });

  it("gives every status a distinct name, so two outcomes cannot read as one", () => {
    const labels = Object.values(reviewStatusLabels);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("is the only status vocabulary in the web app", () => {
    // A second map is how the six came to exist. Anything keyed on two or more status literals with
    // string values is a vocabulary, wherever it lives.
    const offenders = sources(appDir).filter(path => !path.endsWith("review-status.ts")).filter(path => {
      const text = readFileSync(path, "utf8");
      return /(checks_passed|platform_failed|changes_requested)\s*:\s*"[A-Z]/.test(text)
        && /(inconclusive|delivered|budget_exhausted)\s*:\s*"[A-Z]/.test(text);
    }).map(path => path.slice(root.length));
    expect(offenders, "a second status vocabulary drifts from this one - import reviewStatusLabel instead").toEqual([]);
  });

  it("does not print a raw code as prose anywhere it was found doing so", () => {
    const checks: Array<[string, RegExp]> = [
      ["live-history.tsx", /\.replace\(\/_\/g/],
      ["live-quality.tsx", /\{candidate\.reasonCode\}/],
      ["live-audit.tsx", /\{event\.result\}/],
      ["proof/page.tsx", /\?\?\s*status\}/],
    ];
    for (const [file, pattern] of checks) {
      expect(readFileSync(join(appDir, file), "utf8"), `${file} prints a raw code`).not.toMatch(pattern);
    }
  });
});

describe("the other workspace codes", () => {
  it("labels every incomplete reason the server writes", () => {
    // Read from the server, so a new reason added there cannot reach /history unnamed.
    const written = new Set<string>();
    for (const file of ["convex/reviewValidationData.ts", "convex/lib/reviewDecision.ts"]) {
      try {
        for (const match of readFileSync(join(root, file), "utf8").matchAll(/incompleteReason[^;]*?"([a-z_]+)"/g)) written.add(match[1]!);
      } catch { /* not every file exists in every version */ }
    }
    for (const reason of written) expect(incompleteReasonLabels, `${reason} has no label`).toHaveProperty(reason);
    expect(incompleteReasonLabel("anything_new")).not.toContain("_");
  });

  it("names an audit action in words and keeps the exact identifier beside it", () => {
    expect(auditActionLabel("organization.capacity_changed")).toBe("Workspace limits changed");
    expect(auditActionLabel("something.new")).not.toContain(".");
    const audit = readFileSync(join(appDir, "live-audit.tsx"), "utf8");
    // The identifier is forensic evidence in an audit log, so it stays - inside <code>, where the
    // mono-font reservation says exact technical evidence belongs.
    expect(audit).toContain("<code>{event.action}</code>");
    expect(audit).toContain("auditActionLabel(event.action)");
  });

  it("calls a refusal a refusal, because denied is the control working rather than an error", () => {
    expect(auditResultLabel("allowed")).toBe("Allowed");
    expect(auditResultLabel("denied")).toBe("Refused");
  });
});
