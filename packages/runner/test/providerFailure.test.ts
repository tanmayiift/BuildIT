import { APIError, StreamError } from "@vercel/sandbox";
import { describe, expect, it } from "vitest";
import { providerFailureOf, providerFailureShape, tagProviderFailure } from "../src/providerFailure.js";

// Assembled at runtime: a credential-shaped literal anywhere in the tree fails the secret scan.
const hostile = `Status code 422 is not ok: token=${["sk", "live", "7c1"].join("-")} path=/src/rates.js s3://buildit-artifacts/org-a`;
const apiError = (status: number, body: unknown) => new APIError(new Response(null, { status }), { message: hostile, json: body, text: hostile });

describe("what is kept from a sandbox provider failure", () => {
  it("keeps the HTTP status and an identifier code, and nothing the provider wrote", () => {
    const shape = providerFailureShape(apiError(422, { error: { code: "sandbox_stopping", message: hostile } }));
    expect(shape).toEqual({ errorClass: "api_error", httpStatus: 422, providerCode: "sandbox_stopping" });
    expect(JSON.stringify(shape)).not.toMatch(/token=|rates\.js|s3:\/\//);
  });

  it("drops a provider code that is not a plain identifier", () => {
    expect(providerFailureShape(apiError(400, { error: { code: "bad request: see /src/rates.js" } }))).toEqual({ errorClass: "api_error", httpStatus: 400 });
    expect(providerFailureShape(apiError(402, { code: "https://example.test/limits" }))).toEqual({ errorClass: "api_error", httpStatus: 402 });
  });

  it("classifies without reading free text", () => {
    expect(providerFailureShape(new StreamError("sandbox_stopped", hostile, "session"))).toEqual({ errorClass: "stream_error", providerCode: "sandbox_stopped" });
    expect(providerFailureShape(Object.assign(new Error(hostile), { name: "TimeoutError" }))).toEqual({ errorClass: "timeout" });
    expect(providerFailureShape(new TypeError(hostile))).toEqual({ errorClass: "type_error" });
    expect(providerFailureShape(Object.assign(new Error(hostile), { name: `ProviderError ${hostile}` }))).toEqual({ errorClass: "error" });
    expect(providerFailureShape(hostile)).toEqual({ errorClass: "other" });
  });

  it("rethrows the same error, message unchanged, with the call that failed attached", async () => {
    const error = apiError(503, { error: { code: "service_unavailable" } });
    const thrown = await tagProviderFailure({ operation: "acquire", revision: "head" }, async () => { throw error; }).catch(caught => caught);
    expect(thrown).toBe(error);
    expect(thrown.message).toBe(hostile);
    expect(providerFailureOf(thrown)).toEqual({ operation: "acquire", revision: "head", errorClass: "api_error", httpStatus: 503, providerCode: "service_unavailable" });
    // Not enumerable, so nothing that serialises the error starts carrying it.
    expect(Object.keys(thrown)).not.toContain("buildit.providerFailure");
  });

  it("keeps the first call's tag when an outer call rethrows it", async () => {
    const error = new Error("inner");
    const thrown = await tagProviderFailure({ operation: "acquire" }, () => tagProviderFailure({ operation: "write_files" }, async () => { throw error; })).catch(caught => caught);
    expect(providerFailureOf(thrown)?.operation).toBe("write_files");
  });
});
