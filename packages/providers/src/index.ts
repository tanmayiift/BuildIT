export type ProviderName = "anthropic" | "openai" | "gemini";
export type JsonSchema = Record<string, unknown>;
export type ProviderRequest = { model: string; system: string; input: string; schemaName: string; schema: JsonSchema; maxOutputTokens: number };
export type ProviderResult = { value: unknown; provider: ProviderName; model: string; finishReason: string; inputTokens: number; outputTokens: number; requestId?: string | undefined };
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

  async validateKey(provider: ProviderName, apiKey: string) {
    if (!apiKey || apiKey.length < 16) throw new ProviderError("invalid_key");
    const config = provider === "anthropic"
      ? { url: "https://api.anthropic.com/v1/models?limit=1", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } }
      : provider === "openai"
        ? { url: "https://api.openai.com/v1/models", headers: { authorization: `Bearer ${apiKey}` } }
        : { url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", headers: { "x-goog-api-key": apiKey } };
    await checked(await this.http(config.url, { headers: config.headers, signal: AbortSignal.timeout(8_000) }));
    return true;
  }

  async generate(provider: ProviderName, apiKey: string, request: ProviderRequest, allowlist: ReadonlySet<string>): Promise<ProviderResult> {
    assertAllowedModel(request.model, allowlist);assertStrictSchema(request.schema);
    const result=provider === "anthropic"?await this.anthropic(apiKey, request):provider === "openai"?await this.openai(apiKey, request):await this.gemini(apiKey, request);
    if(!validateSchemaValue(result.value,request.schema))throw new ProviderError("malformed_response");return result;
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
    const response = await this.http(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify({ systemInstruction: { parts: [{ text: request.system }] }, contents: [{ role: "user", parts: [{ text: request.input }] }], generationConfig: { temperature:0,maxOutputTokens: request.maxOutputTokens, responseMimeType: "application/json", responseSchema: request.schema } }) });
    const body = await checked(response), feedback = body.promptFeedback as Record<string, unknown> | undefined;
    if (feedback?.blockReason) throw new ProviderError("refused");
    const candidates = Array.isArray(body.candidates) ? body.candidates : [], candidate = candidates[0] as Record<string, unknown> | undefined, finish = String(candidate?.finishReason ?? "unknown");
    if (finish === "MAX_TOKENS") throw new ProviderError("truncated");
    if (finish === "SAFETY" || finish === "BLOCKLIST" || finish === "PROHIBITED_CONTENT") throw new ProviderError("refused");
    const content = candidate?.content as Record<string, unknown> | undefined, parts = Array.isArray(content?.parts) ? content.parts : [], text = (parts.find(part => part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") as Record<string, unknown> | undefined)?.text;
    const usage = body.usageMetadata as Record<string, unknown> | undefined;
    return { value: parseJson(text), provider: "gemini", model: request.model, finishReason: finish, inputTokens: usageNumber(usage?.promptTokenCount), outputTokens: usageNumber(usage?.candidatesTokenCount), requestId: response.headers.get("x-request-id") ?? undefined };
  }
}
