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
//   BUILDIT_EVAL_PROVIDER=openai pnpm eval:detection (when more than one key is configured)
//   pnpm eval:detection --out docs/evidence/detection-<date>.json

const providers = [
  { provider: "anthropic" as const, model: "claude-sonnet-4-5" },
  { provider: "openai" as const, model: "gpt-5" },
  { provider: "gemini" as const, model: "gemini-2.5-pro" },
];

async function chooseProvider() {
  const { readCredential } = await import("@buildit/cli/credential-store");
  const only = process.env.BUILDIT_EVAL_PROVIDER;
  for (const candidate of providers) {
    if (only && candidate.provider !== only) continue;
    const key = readCredential(candidate.provider);
    if (key) return { ...candidate, key };
  }
  return undefined;
}

async function main() {
  const chosen = await chooseProvider();
  if (!chosen) {
    process.stderr.write("no model key: run `buildit configure --provider openai --from-env` once, or set OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY for this run\n");
    process.exitCode = 2;
    return;
  }

  const { ProviderClient } = await import("@buildit/providers");
  const client = new ProviderClient();
  const invoke: StageInvoker = async request => client.generateWithRetry(
    chosen.provider,
    chosen.key!,
    { model: chosen.model, system: request.system, input: request.input, schemaName: request.schemaName, schema: request.schema, maxOutputTokens: request.maxOutputTokens },
    new Set([chosen.model]),
  );

  const started = Date.now();
  const report = await runDetectionSuite({
    invoke,
    onCase: (id, findings) => process.stderr.write(`${id}: ${findings.length} finding${findings.length === 1 ? "" : "s"}\n`),
  });
  const gate = detectionGate(report);

  // Source-free: case ids, counts and a rate. No repository content and no model output.
  const evidence = {
    suite: "detection", cases: detectionCases.length, provider: chosen.provider, model: chosen.model,
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
