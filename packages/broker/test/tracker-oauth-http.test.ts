import { expect, it, vi } from "vitest";
import { issueTrackerOAuthGrant, trackerOAuthRequestHash } from "@buildit/security";
import { handleTrackerOAuth } from "../src/tracker-oauth-http.js";
import { TrackerOAuthBroker } from "../src/tracker-oauth.js";
const secret = Buffer.alloc(32, 2), kms = { generateDataKey: vi.fn(), decryptDataKey: vi.fn(), rewrapDataKey: vi.fn() };
const broker = new TrackerOAuthBroker({ webOrigin: "https://buildit.test" }, kms, "kms");
const body = JSON.stringify({ operation: "availability", scope: { organizationId: "org", provider: "linear", credentialScopeId: "ce744000-1337-4000-8337-ce7440001337" } });
function signed(raw = body) { return issueTrackerOAuthGrant({ organizationId: "org", actorId: "user", operation: "availability", requestHash: trackerOAuthRequestHash(raw) }, secret, 1000); }
function request(token: string, raw = body) { return new Request("https://broker.test/api/tracker-oauth", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: raw }); }
it("requires an exact signed body and refuses replay before touching a secret", async () => {
 const seen = new Set<string>(), consume = vi.fn(async (id: string) => { if (seen.has(id)) return false; seen.add(id); return true; });
 const token = signed(), options = { broker, grantSecret: secret, consume, now: 2000 };
 expect((await handleTrackerOAuth(request(token), options)).status).toBe(200);
 expect((await handleTrackerOAuth(request(token), options)).status).toBe(403);
 expect((await handleTrackerOAuth(request(signed(), body.replace('"org"', '"foreign"')), options)).status).toBe(403);
 expect(kms.decryptDataKey).not.toHaveBeenCalled();
});
it("rejects expired or tampered grants without consuming them", async () => {
 const consume = vi.fn(async () => true), token = signed();
 expect((await handleTrackerOAuth(request(token), { broker, grantSecret: secret, consume, now: 62000 })).status).toBe(403);
 expect((await handleTrackerOAuth(request(`x${token}`), { broker, grantSecret: secret, consume, now: 2000 })).status).toBe(403);
 expect(consume).not.toHaveBeenCalled();
});
