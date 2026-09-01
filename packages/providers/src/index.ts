export type ProviderName = "anthropic" | "openai" | "gemini";
export type JsonSchema = Record<string, unknown>;
export type ProviderRequest = { model: string; system: string; input: string; schemaName: string; schema: JsonSchema; maxOutputTokens: number };
export type ProviderResult = { value: unknown; provider: ProviderName; model: string; finishReason: string; inputTokens: number; outputTokens: number; requestId?: string | undefined };
export const approvedProviderModels:Record<ProviderName,ReadonlySet<string>>={anthropic:new Set(["claude-sonnet-4-5","claude-sonnet-4-6","claude-opus-4-6"]),openai:new Set(["gpt-5","gpt-5.4","gpt-5.4-mini"]),gemini:new Set(["gemini-2.5-pro","gemini-2.5-flash","gemini-3.1-pro-preview"])};
const preferredProviderModels: Record<ProviderName, readonly string[]> = {
  anthropic: ["claude-sonnet-4-6", "claude-sonnet-4-5", "claude-opus-4-6"],
  openai: ["gpt-5.4-mini", "gpt-5.4", "gpt-5"],
  gemini: ["gemini-2.5-pro", "gemini-3.1-pro-preview", "gemini-2.5-flash"],
};
const genericCeiling = { inputPerMillion: 15, outputPerMillion: 75 } as const;
const pinnedPrices: Readonly<Record<string, { inputPerMillion: number; outputPerMillion: number }>> = {
  // OpenAI public API prices checked on 2026-09-01:
  // https://developers.openai.com/api/docs/models/gpt-5.4-mini
  // A 25% margin protects the user ceiling from rounding and small price
  // changes. Unlisted models keep
  // the older, higher ceiling.
  "openai:gpt-5.4-mini": { inputPerMillion: 0.75, outputPerMillion: 4.5 },
  "openai:gpt-5.4": { inputPerMillion: 2.5, outputPerMillion: 15 },
};
const priceSafetyMargin = 1.25;
export type ProviderKeyValidation = { availableModels: string[] };

export function selectProviderModel(provider: ProviderName, availableModels?: readonly string[]) {
  const available = availableModels ? new Set(availableModels) : approvedProviderModels[provider];
  return preferredProviderModels[provider].find(model => available.has(model)) ?? null;
}
export function conservativeProviderModelCost(provider: ProviderName, model: string, inputTokens: number, outputTokens: number) {
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || !Number.isSafeInteger(outputTokens) || outputTokens < 0) throw new Error("model_usage_invalid");
  const price = pinnedPrices[`${provider}:${model}`];
  if (!price) return inputTokens * genericCeiling.inputPerMillion / 1_000_000 + outputTokens * genericCeiling.outputPerMillion / 1_000_000;
  return (inputTokens * price.inputPerMillion / 1_000_000 + outputTokens * price.outputPerMillion / 1_000_000) * priceSafetyMargin;
}
export function conservativeProviderStageCost(provider: ProviderName, model: string, inputBytes: number, maxOutputTokens: number, overheadTokens = 4_096) {
  if (!Number.isSafeInteger(inputBytes) || inputBytes < 0 || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 0 || !Number.isSafeInteger(overheadTokens) || overheadTokens < 0) throw new Error("model_stage_cost_invalid");
  return conservativeProviderModelCost(provider, model, inputBytes + overheadTokens, maxOutputTokens);
}
type Http = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class ProviderError extends Error {
  constructor(public readonly code: "invalid_key" | "rate_limited" | "provider_unavailable" | "refused" | "truncated" | "malformed_response", public readonly status?: number, public readonly retryAfterMs?: number) { super(code); this.name = "ProviderError"; }
}

export function assertAllowedModel(model: string, allowlist: ReadonlySet<string>) { if (!allowlist.has(model)) throw new ProviderError("malformed_response"); }
export function assertStrictSchema(schema:JsonSchema){const visit=(node:unknown)=>{if(!node||typeof node!=="object"||Array.isArray(node))return;const value=node as Record<string,unknown>;if(value.type==="object"&&value.additionalProperties!==false)throw new ProviderError("malformed_response");if(value.properties&&typeof value.properties==="object")for(const child of Object.values(value.properties))visit(child);if(value.items)visit(value.items)};visit(schema)}
export function validateSchemaValue(value:unknown,schema:JsonSchema):boolean{const type=schema.type;if(type==="object"){if(!value||typeof value!=="object"||Array.isArray(value))return false;const record=value as Record<string,unknown>,properties=(schema.properties??{}) as Record<string,JsonSchema>,required=Array.isArray(schema.required)?schema.required:[];if(required.some(key=>typeof key!=="string"||!(key in record)))return false;if(schema.additionalProperties===false&&Object.keys(record).some(key=>!(key in properties)))return false;return Object.entries(record).every(([key,item])=>!properties[key]||validateSchemaValue(item,properties[key]!))}if(type==="array")return Array.isArray(value)&&value.every(item=>validateSchemaValue(item,(schema.items??{}) as JsonSchema));if(type==="string"&&typeof value!=="string"||type==="boolean"&&typeof value!=="boolean"||type==="number"&&(typeof value!=="number"||!Number.isFinite(value))||type==="integer"&&(typeof value!=="number"||!Number.isInteger(value)))return false;if(Array.isArray(schema.enum)&&!schema.enum.includes(value))return false;return true}
function retryAfter(response: Response) { const header=response.headers.get("retry-after");if(header===null)return undefined;const seconds = Number(header); return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : undefined; }
async function checked(response: Response) {
  if (response.status === 401 || response.status === 403) throw new ProviderError("invalid_key", response.status);
  if (response.status === 429) throw new ProviderError("rate_limited", 429, retryAfter(response));
  if (response.status >= 500) throw new ProviderError("provider_unavailable", response.status, retryAfter(response));
  if (!response.ok) throw new ProviderError("malformed_response", response.status);
  try { return await response.json() as Record<string, unknown>; } catch { throw new ProviderError("malformed_response", response.status); }
}
function parseJson(value: unknown) { if (typeof value !== "string") throw new ProviderError("malformed_response"); try { return JSON.parse(value) as unknown; } catch { throw new ProviderError("malformed_response"); } }
function usageNumber(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : 0; }

export class ProviderClient {
  constructor(private readonly http: Http = fetch) {}

  async validateKey(provider: ProviderName, apiKey: string): Promise<ProviderKeyValidation> {
    if (!apiKey || apiKey.length < 16) throw new ProviderError("invalid_key");
    const config: { url: string; headers: Record<string, string> } = provider === "anthropic"
      ? { url: "https://api.anthropic.com/v1/models?limit=100", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } }
      : provider === "openai"
        ? { url: "https://api.openai.com/v1/models", headers: { authorization: `Bearer ${apiKey}` } }
        : { url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=100", headers: { "x-goog-api-key": apiKey } };
    const validationResponse = await this.http(config.url, { headers: config.headers, signal: AbortSignal.timeout(8_000) });
    // Gemini returns HTTP 400 for an invalid API key. This request has a fixed
    // URL and no customer-controlled request body, so 400 here is a safe
    // credential-validation result rather than a generic model-request error.
    if (provider === "gemini" && validationResponse.status === 400) throw new ProviderError("invalid_key", 400);
    const response = await checked(validationResponse);
    const records = Array.isArray(response.models) ? response.models : Array.isArray(response.data) ? response.data : [];
    const availableModels = records.flatMap(item => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>, raw = typeof record.name === "string" ? record.name : typeof record.id === "string" ? record.id : "";
      const model = raw.replace(/^models\//, "");
      const methods = record.supportedGenerationMethods;
      return approvedProviderModels[provider].has(model)
        && (provider !== "gemini" || !Array.isArray(methods) || methods.includes("generateContent")) ? [model] : [];
    });
    const unique = [...new Set(availableModels)].sort((a, b) => preferredProviderModels[provider].indexOf(a) - preferredProviderModels[provider].indexOf(b));
    if (!selectProviderModel(provider, unique)) throw new ProviderError("malformed_response");
    return { availableModels: unique };
  }

  async generate(provider: ProviderName, apiKey: string, request: ProviderRequest, allowlist: ReadonlySet<string>): Promise<ProviderResult> {
    assertAllowedModel(request.model, allowlist);assertStrictSchema(request.schema);
    const result=provider === "anthropic"?await this.anthropic(apiKey, request):provider === "openai"?await this.openai(apiKey, request):await this.gemini(apiKey, request);
    // The provider is asked for strict JSON, but its value is deliberately
    // validated by the prompt-chain stage. That stage records an invalid attempt
    // and sends one bounded repair prompt. Rejecting it here would turn a
    // recoverable schema miss into a terminal review failure.
    return result;
  }

  async generateWithRetry(provider:ProviderName,apiKey:string,request:ProviderRequest,allowlist:ReadonlySet<string>,options={maxRetries:3,baseMs:250},wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))){let last:unknown;for(let attempt=0;attempt<=options.maxRetries;attempt++){try{return await this.generate(provider,apiKey,request,allowlist)}catch(error){last=error;if(!(error instanceof ProviderError)||!["rate_limited","provider_unavailable"].includes(error.code)||attempt===options.maxRetries)throw error;await wait(error.retryAfterMs??options.baseMs*2**attempt)}}throw last}

  private async anthropic(apiKey: string, request: ProviderRequest): Promise<ProviderResult> {
    const response = await this.http("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: request.model, max_tokens: request.maxOutputTokens, temperature:0, system: request.system, messages: [{ role: "user", content: request.input }], tools: [{ name: request.schemaName, description: "Return the validated stage result", input_schema: request.schema, strict: true }], tool_choice: { type: "tool", name: request.schemaName } }) });
    const body = await checked(response), stop = String(body.stop_reason ?? "unknown");
    if (stop === "max_tokens") throw new ProviderError("truncated");
    const content = Array.isArray(body.content) ? body.content : [], tool = content.find((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && (item as Record<string, unknown>).type === "tool_use" && (item as Record<string, unknown>).name === request.schemaName));
    if (!tool || !("input" in tool)) throw new ProviderError("malformed_response");
    const usage = body.usage as Record<string, unknown> | undefined;
    return { value: tool.input, provider: "anthropic", model: request.model, finishReason: stop, inputTokens: usageNumber(usage?.input_tokens), outputTokens: usageNumber(usage?.output_tokens), requestId: response.headers.get("request-id") ?? undefined };
  }

  private async openai(apiKey: string, request: ProviderRequest): Promise<ProviderResult> {
    const response = await this.http("https://api.openai.com/v1/responses", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: request.model, instructions: request.system, input: request.input, max_output_tokens: request.maxOutputTokens, text: { format: { type: "json_schema", name: request.schemaName, strict: true, schema: request.schema } } }) });
    const body = await checked(response);
    if (body.status === "incomplete") throw new ProviderError("truncated");
    const output = Array.isArray(body.output) ? body.output : [], message = output.find((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && (item as Record<string, unknown>).type === "message")), content = Array.isArray(message?.content) ? message.content : [], refusal = content.find(item => item && typeof item === "object" && (item as Record<string, unknown>).type === "refusal"), text = content.find((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && (item as Record<string, unknown>).type === "output_text"));
    if (refusal) throw new ProviderError("refused");
    const usage = body.usage as Record<string, unknown> | undefined;
    return { value: parseJson(text?.text), provider: "openai", model: request.model, finishReason: String(body.status ?? "unknown"), inputTokens: usageNumber(usage?.input_tokens), outputTokens: usageNumber(usage?.output_tokens), requestId: response.headers.get("x-request-id") ?? undefined };
  }

  private async gemini(apiKey: string, request: ProviderRequest): Promise<ProviderResult> {
    const response = await this.http(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify({ systemInstruction: { parts: [{ text: request.system }] }, contents: [{ role: "user", parts: [{ text: request.input }] }], generationConfig: { temperature:0,maxOutputTokens: request.maxOutputTokens, responseMimeType: "application/json", responseJsonSchema: request.schema } }) });
    const body = await checked(response), feedback = body.promptFeedback as Record<string, unknown> | undefined;
    if (feedback?.blockReason) throw new ProviderError("refused");
    const candidates = Array.isArray(body.candidates) ? body.candidates : [], candidate = candidates[0] as Record<string, unknown> | undefined, finish = String(candidate?.finishReason ?? "unknown");
    if (finish === "MAX_TOKENS") throw new ProviderError("truncated");
    if (finish === "SAFETY" || finish === "BLOCKLIST" || finish === "PROHIBITED_CONTENT") throw new ProviderError("refused");
    const content = candidate?.content as Record<string, unknown> | undefined, parts = Array.isArray(content?.parts) ? content.parts : [], text = (parts.find(part => part && typeof part === "object" && (part as Record<string, unknown>).thought !== true && typeof (part as Record<string, unknown>).text === "string") as Record<string, unknown> | undefined)?.text;
    const usage = body.usageMetadata as Record<string, unknown> | undefined;
    return { value: parseJson(text), provider: "gemini", model: request.model, finishReason: finish, inputTokens: usageNumber(usage?.promptTokenCount), outputTokens: usageNumber(usage?.candidatesTokenCount), requestId: response.headers.get("x-request-id") ?? undefined };
  }
}
