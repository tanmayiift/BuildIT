import { describe, expect, it, vi } from "vitest";
import { handleArtifactRequest } from "../src/artifact-http";

function request(method: string, token = "grant-token", init: RequestInit = {}) {
  return new Request("https://broker.example/api/artifacts", { method, ...init,
    headers: { authorization: `Bearer ${token}`, ...init.headers } });
}

describe("artifact HTTP boundary", () => {
  it("uploads only a checksum-bound body and returns metadata", async () => {
    const broker = { put: vi.fn(async () => ({ artifactId: "artifact-a", size: 3, checksum: "a".repeat(64) })) };
    const response = await handleArtifactRequest(request("PUT", "grant", { body: new Uint8Array([1, 2, 3]), headers: { "x-buildit-sha256": "a".repeat(64) } }), broker as never);
    expect(response.status).toBe(201);
    expect(broker.put).toHaveBeenCalledWith("grant", new Uint8Array([1, 2, 3]), "a".repeat(64));
    expect(await response.json()).toEqual({ artifactId: "artifact-a", size: 3, checksum: "a".repeat(64) });
  });

  it("downloads bytes without a storage location", async () => {
    const broker = { get: vi.fn(async () => ({ artifactId: "artifact-a", body: new Uint8Array([4, 5]), checksum: "b".repeat(64) })) };
    const response = await handleArtifactRequest(request("GET"), broker as never);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-buildit-sha256")).toBe("b".repeat(64));
    expect(response.headers.get("location")).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([4, 5]));
  });

  it("deletes one granted artifact", async () => {
    const broker = { delete: vi.fn(async () => ({ artifactId: "artifact-a", deleted: true })) };
    const response = await handleArtifactRequest(request("DELETE"), broker as never);
    expect(response.status).toBe(200);
    expect(broker.delete).toHaveBeenCalledWith("grant-token");
  });

  it("rejects missing authorization, checksum, replay, and unsupported methods safely", async () => {
    const broker = { put: vi.fn(), get: vi.fn(async () => { throw new Error("artifact_grant_replayed"); }) };
    expect((await handleArtifactRequest(new Request("https://broker.example/api/artifacts"), broker as never)).status).toBe(401);
    expect((await handleArtifactRequest(request("PUT", "grant", { body: "x" }), broker as never)).status).toBe(400);
    const replay = await handleArtifactRequest(request("GET"), broker as never);
    expect(replay.status).toBe(410);
    expect(await replay.json()).toEqual({ error: "artifact_grant_replayed" });
    expect((await handleArtifactRequest(request("PATCH"), broker as never)).status).toBe(405);
  });

  it("stops a chunked upload when the HTTP byte ceiling is crossed", async () => {
    const broker = { put: vi.fn() };
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3, 4])); controller.close(); } });
    const upload = new Request("https://broker.example/api/artifacts", { method: "PUT", body, duplex: "half",
      headers: { authorization: "Bearer grant", "x-buildit-sha256": "a".repeat(64) } } as RequestInit & { duplex: "half" });
    const response = await handleArtifactRequest(upload, broker as never, 3);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "artifact_size_invalid" });
    expect(broker.put).not.toHaveBeenCalled();
  });
});
