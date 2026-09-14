import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { forbiddenInlineSourceFieldPattern, storedTextClassifications } from "../../convex/dataClassification";

const schema = ["schema.ts", "accountingSchema.ts", "notificationSchema.ts", "trackerOAuthSchema.ts"].map(file => readFileSync(fileURLToPath(new URL(`../../convex/${file}`, import.meta.url)), "utf8")).join("\n");
const stringFields = [...schema.matchAll(/([A-Za-z][A-Za-z0-9]*):\s*v\.(?:(?:optional|array)\(v\.)*string/g)].map((match) => match[1]);

describe("database data classification", () => {
  it("requires an approved classification for every free-text field", () => {
    const unclassified = [...new Set(stringFields)].filter((field) => !(field in storedTextClassifications));
    expect(unclassified).toEqual([]);
  });

  it("does not keep source-derived prose, paths, commands, logs, diffs, patches, or prompts inline", () => {
    const unsafe = [...new Set(stringFields)].filter((field) => {
      if (field.endsWith("Hash") || field.endsWith("Hmac") || field.endsWith("Fingerprint") || field.endsWith("Version")) return false;
      return forbiddenInlineSourceFieldPattern.test(field);
    });
    expect(unsafe).toEqual([]);
  });

  it("requires every source-content relation to use an artifact ID", () => {
    const contentRelations = [...schema.matchAll(/([A-Za-z][A-Za-z0-9]*(?:Content|Output|Patch|Message|Excerpt|Prompt)[A-Za-z0-9]*):\s*([^,\n]+)/g)];
    const unsafe = contentRelations.filter(([, field, validator]) => !field.endsWith("ArtifactId") || !validator.includes('v.id("artifacts")'));
    expect(unsafe.map((match) => match[1])).toEqual([]);
  });
});
