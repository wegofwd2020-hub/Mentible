import * as syncClient from "@/sync/syncClient";
import { ApiError } from "@/api/client";
import { bytesToBase64, base64ToBytes } from "@/crypto/b64";

global.fetch = jest.fn();
const mockFetch = global.fetch as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

function mockResponse(body: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

const bytes = (n: number, seed = 1) => {
  const u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = (i * seed + 7) % 256;
  return u;
};

describe("syncClient — epubs (octet-stream)", () => {
  it("listEpubs parses the JSON manifest", async () => {
    mockResponse([
      { epub_id: "e1", client_version: "2026-01-01T00:00:00Z", deleted: false, updated_at: "2026-01-01T00:00:00Z", byte_size: 12345 },
    ]);
    const rows = await syncClient.listEpubs("tok-123");
    expect(rows).toEqual([
      { epubId: "e1", clientVersion: "2026-01-01T00:00:00Z", deleted: false, updatedAt: "2026-01-01T00:00:00Z", byteSize: 12345 },
    ]);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/sync/epubs"),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer tok-123" }) }),
    );
  });

  it("putEpub PUTs the framed body as octet-stream with base64 crypto headers and a plaintext client_version", async () => {
    mockResponse({ epub_id: "e1", client_version: "v1", deleted: false, updated_at: null, byte_size: 9 });
    const framedBody = bytes(9, 3);
    const h = {
      nonce: bytes(12, 5),
      metaNonce: bytes(12, 7),
      wrappedDk: bytes(48, 11),
      dkNonce: bytes(12, 13),
      clientVersion: "v1",
    };

    await syncClient.putEpub("tok-123", "e1", framedBody, h);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/sync/epubs/e1");
    expect(init.method).toBe("PUT");
    expect(init.headers["Content-Type"]).toBe("application/octet-stream");
    expect(init.headers["X-Nonce"]).toBe(bytesToBase64(h.nonce));
    expect(init.headers["X-Meta-Nonce"]).toBe(bytesToBase64(h.metaNonce));
    expect(init.headers["X-Wrapped-Dk"]).toBe(bytesToBase64(h.wrappedDk));
    expect(init.headers["X-Dk-Nonce"]).toBe(bytesToBase64(h.dkNonce));
    // Backend reads X-Client-Version via request.headers.get(...) as a plain
    // string (router.py#put_epub), NOT via _b64_header — must NOT be base64.
    expect(init.headers["X-Client-Version"]).toBe("v1");
    expect(init.body).toBe(framedBody);
  });

  it("putEpub surfaces a 413 (single-file or per-account cap) as ApiError with status 413", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 413,
      text: async () => JSON.stringify({ detail: "epub too large" }),
    });
    const h = { nonce: bytes(12), metaNonce: bytes(12), wrappedDk: bytes(48), dkNonce: bytes(12), clientVersion: "v1" };
    await expect(syncClient.putEpub("tok-123", "e1", bytes(9), h)).rejects.toMatchObject({
      status: 413,
    } as Partial<ApiError>);
  });

  it("getEpub reads arrayBuffer -> Uint8Array and round-trips the base64 response headers back to bytes", async () => {
    const framed = bytes(20, 9);
    const nonce = bytes(12, 5), metaNonce = bytes(12, 7), wrappedDk = bytes(48, 11), dkNonce = bytes(12, 13);
    const headerMap: Record<string, string> = {
      "X-Nonce": bytesToBase64(nonce),
      "X-Meta-Nonce": bytesToBase64(metaNonce),
      "X-Wrapped-Dk": bytesToBase64(wrappedDk),
      "X-Dk-Nonce": bytesToBase64(dkNonce),
      "X-Client-Version": "v7",
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: async () => framed.buffer.slice(framed.byteOffset, framed.byteOffset + framed.byteLength),
      headers: { get: (name: string) => headerMap[name] ?? null },
    });

    const result = await syncClient.getEpub("tok-123", "e1");

    expect(result.framedBody).toEqual(framed);
    expect(result.headers.nonce).toEqual(nonce);
    expect(result.headers.metaNonce).toEqual(metaNonce);
    expect(result.headers.wrappedDk).toEqual(wrappedDk);
    expect(result.headers.dkNonce).toEqual(dkNonce);
    expect(result.headers.clientVersion).toBe("v7");
    // Sanity: the base64<->bytes round trip used above is the real helper.
    expect(base64ToBytes(bytesToBase64(nonce))).toEqual(nonce);
  });

  it("deleteEpub issues a DELETE and resolves on 204", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204, text: async () => "" });
    await expect(syncClient.deleteEpub("tok-123", "e1")).resolves.toBeUndefined();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/sync/epubs/e1");
    expect(init.method).toBe("DELETE");
  });
});

describe("syncClient — shelves", () => {
  it("getShelves returns null on 404", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, text: async () => JSON.stringify({ detail: "no shelves" }) });
    await expect(syncClient.getShelves("tok-123")).resolves.toBeNull();
  });

  it("getShelves decodes the base64 blob", async () => {
    const ct = bytes(64, 3), nonce = bytes(12, 5), wdk = bytes(48, 7), dkn = bytes(12, 9);
    mockResponse({
      ciphertext: bytesToBase64(ct),
      nonce: bytesToBase64(nonce),
      wrapped_dk: bytesToBase64(wdk),
      dk_nonce: bytesToBase64(dkn),
      client_version: "s1",
      updated_at: "2026-01-01T00:00:00Z",
    });
    const shelves = await syncClient.getShelves("tok-123");
    expect(shelves).toEqual({
      ciphertext: ct,
      nonce,
      wrappedDk: wdk,
      dkNonce: dkn,
      clientVersion: "s1",
    });
  });

  it("putShelves base64-encodes the byte fields and sends the raw client_version", async () => {
    const ct = bytes(64, 3), nonce = bytes(12, 5), wdk = bytes(48, 7), dkn = bytes(12, 9);
    mockResponse({
      ciphertext: bytesToBase64(ct),
      nonce: bytesToBase64(nonce),
      wrapped_dk: bytesToBase64(wdk),
      dk_nonce: bytesToBase64(dkn),
      client_version: "s2",
      updated_at: "2026-01-01T00:00:00Z",
    });

    await syncClient.putShelves("tok-123", {
      ciphertext: ct, nonce, wrappedDk: wdk, dkNonce: dkn, clientVersion: "s2",
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/sync/shelves");
    expect(init.method).toBe("PUT");
    const sent = JSON.parse(init.body);
    expect(sent.ciphertext).toBe(bytesToBase64(ct));
    expect(sent.client_version).toBe("s2");
  });
});
