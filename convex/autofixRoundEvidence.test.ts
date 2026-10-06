import { describe, expect, it } from "vitest";
import { roundValidationArtifact } from "./reviewAutofixData";

// In production, every autofix round that passed failed delivery with autofix_passed_round_missing:
// the writer named the round's validation `autofix-1-<candidate>-validation.json`, and the reader
// looked for `autofix-1-validation.json`. The test that covered delivery hand-wrote the old name, so
// it agreed with the reader and not with the writer. These use the names the writer produces.
const candidate = "5868dd8989f7a1b2c3d4e5f60718293a4b5c6d7e";
const artifact = (id: string, name: string, over: Partial<{ type: string; storageState: "pending" | "stored"; deletedAt: number }> = {}) => ({
  _id: id, type: "command_output", storageState: "stored" as const, storageKey: `artifacts/org/repo/review/${id}/${name}`, ...over,
});

describe("finding a round's validation evidence", () => {
  const written = artifact("validation-1", `autofix-1-${candidate.slice(0, 12)}-validation.json`);
  const others = [artifact("patch-1", `autofix-1-${candidate.slice(0, 12)}-candidate-0.json`, { type: "patch" }), artifact("validation-2", `autofix-2-${candidate.slice(0, 12)}-validation.json`)];

  it("finds it by the id the round recorded, whatever the writer named the file", () => {
    expect(roundValidationArtifact({ roundNumber: 1, validationArtifactId: "validation-1" }, [...others, written])).toBe(written);
  });

  it("does not hand back evidence that was erased or never finished uploading", () => {
    expect(roundValidationArtifact({ roundNumber: 1, validationArtifactId: "validation-1" }, [{ ...written, deletedAt: 1 }])).toBeUndefined();
    expect(roundValidationArtifact({ roundNumber: 1, validationArtifactId: "validation-1" }, [{ ...written, storageState: "pending" }])).toBeUndefined();
  });

  it("still reads a round recorded before the id was stored, under the one name it was written with", () => {
    const legacy = artifact("legacy", "autofix-1-validation.json");
    expect(roundValidationArtifact({ roundNumber: 1 }, [legacy])).toBe(legacy);
    // And a legacy round never picks up another round's or another commit's evidence by accident.
    expect(roundValidationArtifact({ roundNumber: 1 }, [written, ...others])).toBeUndefined();
  });
});
