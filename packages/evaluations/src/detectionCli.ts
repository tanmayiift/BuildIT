import { writeFile } from "node:fs/promises";
import { detectionCases } from "./detectionCases.js";
import { detectionGate } from "./detection.js";
import { runDetectionSuite, type StageInvoker } from "./detectionRunner.js";

// Measures the question that had no measurement: given this diff, does BuildIT find this defect?
//
// This needs a real provider, so it is not a CI gate - detection varies run to run, and a gate that
// flakes gets switched off. Run it before a release and when a prompt or the chain changes, and
// keep the report: a rate that moves is the signal, not any single run.
//
//   pnpm eval:detection                              (uses the key `buildit configure` stored)
//   OPENAI_API_KEY=… pnpm eval:detection            (or ANTHROPIC_API_KEY / GEMINI_API_KEY)
//   BUILDIT_EVAL_PROVIDER=openai pnpm eval:detection (pin one; otherwise a dead key fails over)
//   pnpm eval:detection --out docs/evidence/detection-<date>.json

const providers = [
  { provider: "anthropic" as const, model: "claude-sonnet-4-5" },
  { provider: "openai" as const, model: "gpt-5" },
  { provider: "gemini" as const, model: "gemini-2.5-pro" },
];

async function availableProviders() {
  const { readCredential } = await import("@buildit/cli/credential-store");
  const only = process.env.BUILDIT_EVAL_PROVIDER;
  const found: Array<{ provider: (typeof providers)[number]["provider"]; model: string; key: string }> = [];
  for (const candidate of providers) {
    if (only && candidate.provider !== only) continue;
    const key = readCredential(candidate.provider);
    if (key) found.push({ ...candidate, key });
  }
  return found;
}

// A provider that rejects the key, is out of quota or is rate-limited is worth failing over. A
// schema-invalid response is not: that is the model answering badly, which the chain repairs and
// the score is supposed to see.
const credentialFailure = /401|403|429|invalid[_ ]api[_ ]key|unauthorized|quota|rate[_ ]limit|insufficient_quota/i;

async function main() {
  const configured = await availableProviders();
  const chosen = configured[0];
  if (!chosen) {
    process.stderr.write("no model key: run `buildit configure --provider openai --from-env` once, or set OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY for this run\n");
    process.exitCode = 2;
    return;
  }

  const { ProviderClient } = await import("@buildit/providers");
  const client = new ProviderClient();
  // Which provider is answering can change mid-suite, so the report says who actually did the work
  // rather than who was asked first.
  let active = chosen;
  const failedOver: string[] = [];
  const invoke: StageInvoker = async request => {
    const remaining = configured.slice(configured.indexOf(active));
    let lastError: unknown;
    for (const candidate of remaining) {
      try {
        const result = await client.generateWithRetry(
          candidate.provider, candidate.key,
          { model: candidate.model, system: request.system, input: request.input, schemaName: request.schemaName, schema: request.schema, maxOutputTokens: request.maxOutputTokens },
          new Set([candidate.model]),
        );
        if (candidate !== active) { failedOver.push(`${active.provider}→${candidate.provider}`); active = candidate; }
        return result;
      } catch (error) {
        lastError = error;
        if (!credentialFailure.test(String((error as Error)?.message ?? error))) throw error;
        process.stderr.write(`${candidate.provider}: key unusable, trying the next configured provider\n`);
      }
    }
    throw lastError;
  };

  const started = Date.now();
  const report = await runDetectionSuite({
    invoke,
    onCase: (id, findings) => process.stderr.write(`${id}: ${findings.length} finding${findings.length === 1 ? "" : "s"}\n`),
  });
  const gate = detectionGate(report);

  // Source-free: case ids, counts and a rate. No repository content and no model output.
  const evidence = {
    suite: "detection", cases: detectionCases.length, provider: active.provider, model: active.model,
    ...(failedOver.length ? { failedOver } : {}),
    detected: report.detected, ofDefects: report.defects,
    detectionRate: Number(report.detectionRate.toFixed(3)),
    missed: report.missed, falseBlocking: report.falseBlocking,
    durationMs: Date.now() - started, passed: gate.passed, reasons: gate.reasons,
  };

  const outIndex = process.argv.indexOf("--out");
  if (outIndex > -1 && process.argv[outIndex + 1]) await writeFile(process.argv[outIndex + 1]!, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  process.exitCode = gate.passed ? 0 : 1;
}

await main();
