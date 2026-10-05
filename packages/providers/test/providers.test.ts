import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { assertStrictSchema, checked, conservativeProviderModelCost, conservativeProviderStageCost, geminiThinkingAllowance, ProviderClient, ProviderError, selectProviderModel, validateSchemaValue } from "../src/index.js";
const request={model:"allowed",system:"policy",input:"data",schemaName:"result",schema:{type:"object",properties:{ok:{type:"boolean"}},required:["ok"],additionalProperties:false},maxOutputTokens:100};
describe("provider adapters",()=>{
  // `key in record` walks the prototype chain, so "constructor", "toString" and "__proto__" are
  // present on every object literal. A model response carrying one of those keys therefore passed
  // additionalProperties:false - an unexpected key smuggled past the validator by name alone - and
  // `required` was satisfied by a key the response never sent. src/index.ts uses own() for all
  // three checks now; this is what stops it going back to `in`, which reads as equivalent.
  it("rejects prototype-named properties rather than reading them off the prototype chain",()=>{
    const schema={type:"object",properties:{ok:{type:"boolean"}},required:["ok"],additionalProperties:false} as const;
    // JSON.parse rather than a literal: an inline __proto__ key would set the prototype instead of
    // becoming an own property, and the test would pass without exercising anything.
    for(const key of ["constructor","toString","__proto__","hasOwnProperty"]){
      expect(validateSchemaValue(JSON.parse(`{"ok":true,"${key}":"smuggled"}`),schema),key).toBe(false);
    }
    expect(validateSchemaValue({ok:true},schema)).toBe(true);
  });
  it("does not accept a prototype-named key as a satisfied required field",()=>{
    const schema={type:"object",properties:{toString:{type:"string"}},required:["toString"]} as const;
    expect(validateSchemaValue({},schema),"required must mean the response actually sent it").toBe(false);
    expect(validateSchemaValue(JSON.parse('{"toString":"real"}'),schema)).toBe(true);
  });
  it("prefers the cost-effective OpenAI review model when the key can use it",()=>{
    expect(selectProviderModel("openai",["gpt-5.4","gpt-5.4-mini"])).toBe("gpt-5.4-mini");
  });
  // 5 Oct 2026: a billed Gemini key answered gemini-3.1-pro-preview and returned 404 for both 2.5 models.
  it("prefers the Gemini model a current key answers, and still takes an older one when that is all it lists",()=>{
    expect(selectProviderModel("gemini",["gemini-2.5-pro","gemini-3.1-pro-preview","gemini-2.5-flash"])).toBe("gemini-3.1-pro-preview");
    expect(selectProviderModel("gemini",["gemini-2.5-pro"])).toBe("gemini-2.5-pro");
  });
  // Pinned at Google's >200k-token tier ($4/$18), so the ceiling holds at any prompt size; unpinned it was
  // reserved at the generic $15/$75 and a zod-sized review could not fit a $5 ceiling.
  it("reserves Gemini 3.1 Pro at its published price, not the generic ceiling",()=>{
    expect(conservativeProviderModelCost("gemini","gemini-3.1-pro-preview",1_000_000,1_000_000)).toBe(27.5);
    expect(conservativeProviderModelCost("gemini","gemini-3.1-pro-preview",95_000,1_000)).toBeLessThan(0.5);
    expect(conservativeProviderModelCost("gemini","gemini-2.5-pro",1_000_000,1_000_000)).toBe(90);
  });
  it("uses pinned model prices with a safety margin and a fail-closed fallback",()=>{
    expect(conservativeProviderModelCost("openai","gpt-5.4-mini",1_000_000,1_000_000)).toBe(6.5625);
    expect(conservativeProviderModelCost("openai","gpt-5.4",1_000_000,1_000_000)).toBe(21.875);
    expect(conservativeProviderModelCost("openai","unpriced-model",1_000_000,1_000_000)).toBe(90);
    expect(conservativeProviderStageCost("openai","gpt-5.4-mini",1_000,800)).toBe(conservativeProviderModelCost("openai","gpt-5.4-mini",5_096,800));
  });
  it("validates Gemini keys in a header, never a URL, and records only supported models",async()=>{const http=vi.fn(async(input:string|URL,init?:RequestInit)=>{expect(String(input)).not.toContain("secret-key-value");expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("secret-key-value");return new Response(JSON.stringify({models:[{name:"models/gemini-2.5-pro",supportedGenerationMethods:["generateContent"]},{name:"models/gemini-2.5-flash",supportedGenerationMethods:["embedContent"]},{name:"models/not-approved",supportedGenerationMethods:["generateContent"]}]}))});await expect(new ProviderClient(http).validateKey("gemini","secret-key-value")).resolves.toEqual({availableModels:["gemini-2.5-pro"]})});
  it("normalizes Anthropic tool output",async()=>{const http=vi.fn(async()=>new Response(JSON.stringify({stop_reason:"tool_use",content:[{type:"tool_use",name:"result",input:{ok:true}}],usage:{input_tokens:4,output_tokens:2}})));await expect(new ProviderClient(http).generate("anthropic","key",request,new Set(["allowed"]))).resolves.toMatchObject({value:{ok:true},inputTokens:4,outputTokens:2})});
  it("normalizes OpenAI structured output",async()=>{const http=vi.fn(async()=>new Response(JSON.stringify({status:"completed",output:[{type:"message",content:[{type:"output_text",text:"{\"ok\":true}"}]}],usage:{input_tokens:3,output_tokens:1}})));await expect(new ProviderClient(http).generate("openai","key",request,new Set(["allowed"]))).resolves.toMatchObject({value:{ok:true},finishReason:"completed"})});
  // 5 Oct 2026: gemini-3.1-pro-preview spent the findings stage's whole 8,000-token limit thinking and
  // stopped at MAX_TOKENS three times, at temperature 0, which Google warns can make Gemini 3 loop.
  it("gives Gemini 3 room to think beyond the answer, at low thinking and its default temperature",async()=>{
    const bodies:Array<Record<string,any>>=[];
    const client=new ProviderClient(async(_url:string|URL,init?:RequestInit)=>{bodies.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:"{\"ok\":true}"}]}}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:1}}),{status:200});});
    const ask={model:"gemini-3.1-pro-preview",system:"s",input:"i",schemaName:"r",schema:{type:"object",properties:{ok:{type:"boolean"}},required:["ok"],additionalProperties:false},maxOutputTokens:8_000};
    await client.generate("gemini","key-value",ask,new Set(["gemini-3.1-pro-preview","gemini-2.5-pro"]));
    await client.generate("gemini","key-value",{...ask,model:"gemini-2.5-pro"},new Set(["gemini-3.1-pro-preview","gemini-2.5-pro"]));
    expect(bodies[0]!.generationConfig).toMatchObject({maxOutputTokens:8_000+geminiThinkingAllowance,thinkingConfig:{thinkingLevel:"low"}});
    expect(bodies[0]!.generationConfig).not.toHaveProperty("temperature");
    expect(bodies[1]!.generationConfig).toMatchObject({maxOutputTokens:8_000,temperature:0});
    expect(bodies[1]!.generationConfig).not.toHaveProperty("thinkingConfig");
  });
  it("reserves the thinking allowance a Gemini call may spend, and nothing extra for other providers",()=>{
    expect(conservativeProviderStageCost("gemini","gemini-3.1-pro-preview",1_000,8_000)).toBe(conservativeProviderModelCost("gemini","gemini-3.1-pro-preview",5_096,8_000+geminiThinkingAllowance));
    expect(conservativeProviderStageCost("openai","gpt-5.4-mini",1_000,8_000)).toBe(conservativeProviderModelCost("openai","gpt-5.4-mini",5_096,8_000));
    expect(conservativeProviderStageCost("gemini","gemini-2.5-pro",1_000,8_000)).toBe(conservativeProviderModelCost("gemini","gemini-2.5-pro",5_096,8_000));
  });
  it("normalizes Gemini structured output",async()=>{const http=vi.fn(async(_url:string|URL,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));expect(body.generationConfig.responseJsonSchema).toEqual(request.schema);expect(body.generationConfig.responseSchema).toBeUndefined();return new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:"{\"ok\":true}"}]}}],usageMetadata:{promptTokenCount:3,candidatesTokenCount:1}}))});await expect(new ProviderClient(http).generate("gemini","key",request,new Set(["allowed"]))).resolves.toMatchObject({value:{ok:true},finishReason:"STOP"})});
  it("uses Gemini's final non-thought structured-output part",async()=>{const client=new ProviderClient(async()=>new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{thought:true,text:"internal reasoning must not be parsed"},{text:"{\"ok\":true}"}]}}]})));await expect(client.generate("gemini","key",request,new Set(["allowed"]))).resolves.toMatchObject({value:{ok:true},finishReason:"STOP"})});
  it("uses sanitized provider errors",async()=>{const client=new ProviderClient(async()=>new Response(JSON.stringify({error:{message:"secret leaked upstream"}}),{status:401}));await expect(client.validateKey("gemini","secret-key-value")).rejects.toEqual(expect.objectContaining({message:"invalid_key"}));await expect(client.validateKey("gemini","short")).rejects.toBeInstanceOf(ProviderError)});
  it("maps Gemini's fixed validation-request 400 to an invalid key without reading error text",async()=>{const client=new ProviderClient(async()=>new Response("provider detail must not escape",{status:400}));await expect(client.validateKey("gemini","secret-key-value")).rejects.toMatchObject({message:"invalid_key",status:400})});
  it("rejects non-strict input schemas but leaves parseable output validation to the bounded repair stage",async()=>{expect(()=>assertStrictSchema({type:"object",properties:{nested:{type:"object",properties:{}}},additionalProperties:false})).toThrow("malformed_response");const client=new ProviderClient(async()=>new Response(JSON.stringify({status:"completed",output:[{type:"message",content:[{type:"output_text",text:'{"ok":true,"extra":1}'}]}]})));await expect(client.generate("openai","key",request,new Set(["allowed"]))).resolves.toMatchObject({value:{ok:true,extra:1}})});
  it("rejects a strict-schema object when any declared property is optional",()=>{
    expect(()=>assertStrictSchema({type:"object",properties:{criterionId:{type:"string"}},required:[],additionalProperties:false})).toThrow("malformed_response");
  });
  it("retries only temporary 429 and 529 failures with bounded backoff",async()=>{let call=0;const waits:number[]=[];const client=new ProviderClient(async()=>++call===1?new Response("",{status:429,headers:{"retry-after":"1"}}):call===2?new Response("",{status:529}):new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:'{"ok":true}'}]}}]})));await expect(client.generateWithRetry("gemini","key",request,new Set(["allowed"]),{maxRetries:2,baseMs:10},async ms=>{waits.push(ms)})).resolves.toMatchObject({value:{ok:true}});expect(waits).toEqual([1000,20]);const invalid=new ProviderClient(async()=>new Response("",{status:401}));await expect(invalid.generateWithRetry("gemini","key",request,new Set(["allowed"]),{maxRetries:3,baseMs:1},async()=>{})).rejects.toMatchObject({code:"invalid_key"})});
});

// OpenAI returns 429 both for a rate limit and for an account with no credit. They are opposite
// conditions - one clears by waiting, the other never does - and both were classified as
// rate_limited, retried four times, then reported as "the provider is busy".
describe("telling a rate limit from an empty account", () => {
  const body = (payload: unknown) => new Response(JSON.stringify(payload), {
    status: 429, headers: { "content-type": "application/json" },
  });

  it("reads an exhausted quota out of the 429 body", async () => {
    await expect(checked(body({ error: { message: "You exceeded your current quota", type: "insufficient_quota" } })))
      .rejects.toMatchObject({ code: "quota_exhausted" });
  });

  it("leaves a genuine rate limit retryable, with its Retry-After intact", async () => {
    const response = new Response(JSON.stringify({ error: { message: "Rate limit reached", type: "requests" } }), {
      status: 429, headers: { "content-type": "application/json", "retry-after": "30" },
    });
    await expect(checked(response)).rejects.toMatchObject({ code: "rate_limited", retryAfterMs: 30_000 });
  });

  it("does not retry an exhausted quota, because the answer will not change", async () => {
    // The retry list is the contract: rate_limited and provider_unavailable only.
    const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    const retryList = source.match(/\["rate_limited","provider_unavailable"\]/);
    expect(retryList).not.toBeNull();
    expect(source).not.toContain('["rate_limited","quota_exhausted"');
  });
});

describe("tokens served from a provider's prompt cache", () => {
  const anthropic = (usage: Record<string, unknown>) => new ProviderClient(vi.fn(async () => new Response(JSON.stringify({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "result", input: { ok: true } }], usage }))));

  it("adds Anthropic's cache reads and writes to the input it reports beside them", async () => {
    // input_tokens excludes both; left out, a cached call would be accounted as nearly free.
    await expect(anthropic({ input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 }).generate("anthropic", "key", request, new Set(["allowed"])))
      .resolves.toMatchObject({ inputTokens: 160, cachedInputTokens: 100, outputTokens: 2, usageKnown: true });
  });

  it("refuses to call usage known when a cache count is malformed", async () => {
    await expect(anthropic({ input_tokens: 10, output_tokens: 2, cache_read_input_tokens: -1 }).generate("anthropic", "key", request, new Set(["allowed"])))
      .resolves.toMatchObject({ usageKnown: false });
  });

  it("reads OpenAI's cached count from inside its input total, and keys the cache by stage", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const client = new ProviderClient(async (_url: string | URL, init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "{\"ok\":true}" }] }], usage: { input_tokens: 100, output_tokens: 1, input_tokens_details: { cached_tokens: 64 } } })); });
    await expect(client.generate("openai", "key", request, new Set(["allowed"]))).resolves.toMatchObject({ inputTokens: 100, cachedInputTokens: 64 });
    expect(bodies[0]?.prompt_cache_key).toBe(request.schemaName);
  });

  it("reads Gemini's cached count from inside its prompt total", async () => {
    const client = new ProviderClient(async () => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{\"ok\":true}" }] } }], usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 1, cachedContentTokenCount: 40 } })));
    await expect(client.generate("gemini", "key", request, new Set(["allowed"]))).resolves.toMatchObject({ inputTokens: 80, cachedInputTokens: 40 });
  });

  it("reports nothing cached when nothing was", async () => {
    const result = await anthropic({ input_tokens: 4, output_tokens: 2 }).generate("anthropic", "key", request, new Set(["allowed"]));
    expect(result).not.toHaveProperty("cachedInputTokens");
  });
});
