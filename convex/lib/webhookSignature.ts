// The signature check that actually guards the GitHub webhook endpoint. It lived inline in
// convex/http.ts, which no test imports, while a second Node-crypto implementation in
// packages/github was tested and called by nothing but its own test - so the tested verifier was
// not the live one, and the live one had no coverage at all.
//
// It stays here rather than in packages/github because convex/http.ts runs in the Convex runtime,
// which has WebCrypto but not node:crypto.
export async function validSignature(body: ArrayBuffer, header: string, secret: string) {
  if (!/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, body));
  const actual = Uint8Array.from(header.slice(7).match(/../g) ?? [], value => Number.parseInt(value, 16));
  if (actual.length !== digest.length) return false;
  // Constant time: a length-independent comparison would leak the expected digest byte by byte.
  let mismatch = 0;
  for (let index = 0; index < actual.length; index++) mismatch |= actual[index]! ^ digest[index]!;
  return mismatch === 0;
}
