import { APIError, StreamError } from "@vercel/sandbox";

// What may be recorded about a sandbox-provider failure.
//
// A real failure on 5 Oct 2026 reached the broker log as `sandbox_unavailable`, category
// `unexpected`, and nothing else - the provider's message is deliberately never logged, because it
// carries the provider's request context and sometimes repository content. That left no way to tell
// a plan limit from a stopping sandbox from a bad request, and the cause was guessed (wrongly). These
// are the fields that answer it while carrying no text: the HTTP status, the provider's own error
// code when it is a plain identifier, a closed class, and which call failed.
export type ProviderOperation = "acquire" | "lookup" | "write_files" | "run_command" | "read_file" | "network_policy" | "stop" | "delete";
export type ProviderErrorClass = "api_error" | "stream_error" | "timeout" | "abort" | "type_error" | "error" | "other";
export type ProviderFailure = { operation: ProviderOperation; revision?: "base" | "head"; errorClass: ProviderErrorClass; httpStatus?: number; providerCode?: string };

const failureTag = Symbol.for("buildit.providerFailure");
// A code is logged only when it is an identifier. Anything else - a sentence, a URL, a path - is
// exactly the free text this exists to keep out of logs.
const identifier = (value: unknown) => typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : undefined;

export function providerFailureShape(error: unknown): Omit<ProviderFailure, "operation" | "revision"> {
  if (error instanceof APIError) {
    const status = (error.response as { status?: unknown } | undefined)?.status;
    const body = error.json as { error?: { code?: unknown }; code?: unknown } | undefined;
    const providerCode = identifier(body?.error?.code ?? body?.code);
    return { errorClass: "api_error", ...(typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? { httpStatus: status } : {}), ...(providerCode ? { providerCode } : {}) };
  }
  if (error instanceof StreamError) {
    const providerCode = identifier(error.code);
    return { errorClass: "stream_error", ...(providerCode ? { providerCode } : {}) };
  }
  if (error instanceof Error && error.name === "TimeoutError") return { errorClass: "timeout" };
  if (error instanceof Error && error.name === "AbortError") return { errorClass: "abort" };
  if (error instanceof TypeError) return { errorClass: "type_error" };
  if (error instanceof Error) return { errorClass: "error" };
  return { errorClass: "other" };
}

// Rethrows the same error with its shape attached, so every existing classification of the message
// is unchanged and the public error code stays exactly what it was.
export async function tagProviderFailure<T>(where: { operation: ProviderOperation; revision?: "base" | "head" }, call: () => Promise<T>): Promise<T> {
  try { return await call(); }
  catch (error) {
    if (error && typeof error === "object" && !(failureTag in error)) {
      try { Object.defineProperty(error, failureTag, { value: { ...where, ...providerFailureShape(error) } satisfies ProviderFailure, enumerable: false }); }
      catch { /* a frozen error is rethrown untagged */ }
    }
    throw error;
  }
}

export function providerFailureOf(error: unknown): ProviderFailure | undefined {
  return error && typeof error === "object" && failureTag in error ? (error as Record<symbol, ProviderFailure>)[failureTag] : undefined;
}
