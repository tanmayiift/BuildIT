export type SourceFile = { path: string; content: string };
export type EffectiveLoc = { added: number; removed: number; net: number; reverted: number; eligibleFiles: number; excludedFiles: number };

const excludedPath = /(^|\/)(?:node_modules|vendor|vendors|dist|build|coverage|\.next|target|generated|__generated__)(\/|$)|(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|composer\.lock)$|\.(?:min\.(?:js|css)|map|snap|svg|png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|eot)$/i;
const supported = /\.(?:[cm]?[jt]sx?|java|kt|kts|py|rb|go|rs|php|cs|swift|scala|sh|bash|zsh)$/i;

function stripCStyle(input: string) {
  let output = "", quote = "", block = false, escaped = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index]!, next = input[index + 1];
    if (block) { if (char === "*" && next === "/") { block = false; index++; } else if (char === "\n") output += "\n"; continue; }
    if (quote) { output += char; if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === quote) quote = ""; continue; }
    if (char === '"' || char === "'" || char === "`") { quote = char; output += char; continue; }
    if (char === "/" && next === "*") { block = true; index++; continue; }
    if (char === "/" && next === "/") { while (index < input.length && input[index] !== "\n") index++; output += "\n"; continue; }
    output += char;
  }
  return output;
}

function stripHashComments(input: string) {
  return input.split("\n").map(line => {
    let quote = "", escaped = false;
    for (let index = 0; index < line.length; index++) {
      const char = line[index]!;
      if (quote) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === quote) quote = ""; continue; }
      if (char === '"' || char === "'") quote = char;
      else if (char === "#") return line.slice(0, index);
    }
    return line;
  }).join("\n");
}

export function normalizedExecutableLines(file: SourceFile) {
  if (excludedPath.test(file.path) || !supported.test(file.path)) return [];
  const withoutComments = /\.(?:py|rb|sh|bash|zsh)$/i.test(file.path) ? stripHashComments(file.content) : stripCStyle(file.content);
  return withoutComments.split("\n").map(line => line.trim().replace(/\s+/g, " ").replace(/\s*([{}()[\],;:+*%<>=!?|&.-])\s*/g, "$1")).filter(Boolean);
}

function counts(files: SourceFile[]) {
  const values = new Map<string, number>(); let eligibleFiles = 0, excludedFiles = 0;
  for (const file of files) {
    const lines = normalizedExecutableLines(file);
    if (!lines.length) { excludedFiles++; continue; }
    eligibleFiles++;
    for (const line of lines) values.set(line, (values.get(line) ?? 0) + 1);
  }
  return { values, eligibleFiles, excludedFiles };
}

export function calculateEffectiveLoc(base: SourceFile[], candidate: SourceFile[], later?: SourceFile[]): EffectiveLoc {
  const before = counts(base), after = counts(candidate); let added = 0, removed = 0;
  for (const [line, count] of after.values) added += Math.max(0, count - (before.values.get(line) ?? 0));
  for (const [line, count] of before.values) removed += Math.max(0, count - (after.values.get(line) ?? 0));
  let reverted = 0;
  if (later) {
    const final = counts(later);
    for (const [line, count] of after.values) {
      const deliveredAddition = Math.max(0, count - (before.values.get(line) ?? 0));
      reverted += Math.min(deliveredAddition, Math.max(0, count - (final.values.get(line) ?? 0)));
    }
  }
  return { added, removed, net: added - removed, reverted, eligibleFiles: after.eligibleFiles, excludedFiles: after.excludedFiles };
}
