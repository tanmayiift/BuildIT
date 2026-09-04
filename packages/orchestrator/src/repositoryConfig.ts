import { load } from "js-yaml";

// The settings a repository may set for itself, in a file its own engineers review like code.
//
// Whether this file may be believed at all is decided elsewhere, by trustedConfiguration, which has
// existed unused since the beginning and already refuses configuration taken from a pull request
// head. That is the security property that matters: without it, anyone opening a pull request could
// rewrite the rules of the review running on that same pull request.
//
// This parser is deliberately total. A config file is written by a person and read by a machine
// that has to keep reviewing their code either way, so nothing here throws: an unreadable file
// means defaults plus a stated reason, never a refused review.

export type RepositoryConfig = {
  reviewProfile?: "quiet" | "balanced" | "thorough";
  reviewTrigger?: "manual" | "automatic";
  pathFilters?: string[];
  pathInstructions?: Array<{ path: string; instructions: string }>;
};

// Bounds, because this text arrives from a repository and every field ends up somewhere that costs
// something: filters in a fetch decision, instructions in a model prompt.
const maxPathFilters = 100, maxInstructions = 50, maxInstructionLength = 2_000, maxPathLength = 200;

const profiles = new Set(["quiet", "balanced", "thorough"]);
const triggers = new Set(["manual", "automatic"]);

export function parseRepositoryConfig(source: string) {
  const problems: string[] = [];
  const config: RepositoryConfig = {};

  let document: unknown;
  try {
    document = load(source, { schema: undefined });
  } catch {
    return { valid: false, config, problems: ["The file is not valid YAML, so BuildIT used its defaults."] };
  }
  if (document === null || document === undefined) return { valid: true, config, problems };
  if (typeof document !== "object" || Array.isArray(document)) {
    return { valid: false, config, problems: ["The file must be a mapping of settings, so BuildIT used its defaults."] };
  }

  const raw = document as Record<string, unknown>;

  if (raw.reviewProfile !== undefined) {
    if (typeof raw.reviewProfile === "string" && profiles.has(raw.reviewProfile)) config.reviewProfile = raw.reviewProfile as "quiet" | "balanced" | "thorough";
    else problems.push("reviewProfile must be quiet, balanced or thorough.");
  }

  if (raw.reviewTrigger !== undefined) {
    if (typeof raw.reviewTrigger === "string" && triggers.has(raw.reviewTrigger)) config.reviewTrigger = raw.reviewTrigger as "manual" | "automatic";
    else problems.push("reviewTrigger must be manual or automatic.");
  }

  if (raw.pathFilters !== undefined) {
    const value = raw.pathFilters;
    if (!Array.isArray(value) || value.some(item => typeof item !== "string")) problems.push("pathFilters must be a list of glob patterns.");
    else if (value.length > maxPathFilters) problems.push(`pathFilters may hold at most ${maxPathFilters} patterns.`);
    else if (value.some(item => (item as string).length > maxPathLength)) problems.push(`Each entry in pathFilters must be under ${maxPathLength} characters.`);
    else config.pathFilters = value as string[];
  }

  if (raw.pathInstructions !== undefined) {
    const value = raw.pathInstructions;
    const wellFormed = Array.isArray(value) && value.every(item =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
      && typeof (item as { path?: unknown }).path === "string"
      && typeof (item as { instructions?: unknown }).instructions === "string");
    if (!wellFormed) problems.push("pathInstructions must be a list of entries with a path and instructions.");
    else if (value.length > maxInstructions) problems.push(`pathInstructions may hold at most ${maxInstructions} entries.`);
    else if (value.some(item => (item as { instructions: string }).instructions.length > maxInstructionLength)) {
      problems.push(`Each entry in pathInstructions must be under ${maxInstructionLength} characters.`);
    } else if (value.some(item => (item as { path: string }).path.length > maxPathLength)) {
      problems.push(`Each path in pathInstructions must be under ${maxPathLength} characters.`);
    } else {
      config.pathInstructions = (value as Array<{ path: string; instructions: string }>).map(item => ({ path: item.path, instructions: item.instructions }));
    }
  }

  return { valid: problems.length === 0, config, problems };
}

// Which instructions a review actually carries. Only those whose paths the change touched: an
// instruction about SQL has nothing to say about a change that touched no SQL, and carrying all of
// them would spend the prompt budget on advice about files nobody edited.
//
// This text is controlled by the repository, so it reaches the prompt as a narrative surface -
// the same class as a pull request description - and is bounded here before it gets there. An
// instruction may steer attention and nothing else: the evidence gate runs after the model has
// spoken and never reads this, and scanners never see a prompt at all.
const maxInstructionBudget = 4_000;

export function instructionsForPaths(
  instructions: ReadonlyArray<{ path: string; instructions: string }> | undefined,
  changedPaths: ReadonlyArray<string>,
) {
  if (!instructions?.length || !changedPaths.length) return [];
  const selected: string[] = [];
  let budget = maxInstructionBudget;
  for (const entry of instructions) {
    if (selected.includes(entry.instructions)) continue;
    const matcher = globMatcher(entry.path);
    if (!changedPaths.some(path => matcher.test(path))) continue;
    if (entry.instructions.length > budget) break;
    selected.push(entry.instructions);
    budget -= entry.instructions.length;
  }
  return selected;
}

// The same small dialect the path filters use, and literal metacharacters for the same reason.
function globMatcher(glob: string) {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index]!;
    if (character === "*") {
      if (glob[index + 1] === "*") {
        source += glob[index + 2] === "/" ? "(?:.*/)?" : ".*";
        index += glob[index + 2] === "/" ? 2 : 1;
      } else { source += "[^/]*"; }
      continue;
    }
    if (character === "?") { source += "[^/]"; continue; }
    source += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}
