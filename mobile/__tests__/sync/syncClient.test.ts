import * as syncClient from "@/sync/syncClient";
import { ApiError } from "@/api/client";
import { bytesToBase64 } from "@/crypto/b64";

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

describe("syncClient — auth + base64<->bytes boundary", () => {
  it("getKeyset sends Bearer auth and decodes base64 fields to bytes", async () => {
    const wrappedLmk = bytes(48), lmkNonce = bytes(12), kekSalt = bytes(16);
    mockResponse({
      wrapped_lmk: bytesToBase64(wrappedLmk),
      lmk_nonce: bytesToBase64(lmkNonce),
      kek_salt: bytesToBase64(kekSalt),
      created_at: "2026-01-01T00:00:00Z",
    });

    const keyset = await syncClient.getKeyset("tok-123");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/sync/keyset"),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer tok-123" }),
      }),
    );
    expect(keyset.wrappedLmk).toEqual(wrappedLmk);
    expect(keyset.lmkNonce).toEqual(lmkNonce);
    expect(keyset.kekSalt).toEqual(kekSalt);
  });

  it("putKeyset base64-encodes byte fields in the request body and appends force=true", async () => {
    mockResponse({
      wrapped_lmk: bytesToBase64(bytes(48)),
      lmk_nonce: bytesToBase64(bytes(12)),
      kek_salt: bytesToBase64(bytes(16)),
    });

    await syncClient.putKeyset(
      "tok-123",
      { wrappedLmk: bytes(48), lmkNonce: bytes(12), kekSalt: bytes(16) },
      true,
    );

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/sync/keyset?force=true");
    expect(init.method).toBe("PUT");
    const sent = JSON.parse(init.body);
    expect(sent.wrapped_lmk).toBe(bytesToBase64(bytes(48)));
    expect(sent.force).toBe(true);
  });

  it("putKeyset surfaces a 409 as ApiError", async () => {
    mockResponse({ detail: "conflict" }, 409);
    await expect(
      syncClient.putKeyset("tok-123", { wrappedLmk: bytes(48), lmkNonce: bytes(12), kekSalt: bytes(16) }),
    ).rejects.toMatchObject({ status: 409 } as Partial<ApiError>);
  });

  it("listBooks decodes the metadata array (no ciphertext field expected)", async () => {
    mockResponse([
      { book_id: "b1", client_version: "2026-01-01T00:00:00Z", deleted: false, updated_at: "2026-01-01T00:00:00Z" },
    ]);
    const rows = await syncClient.listBooks("tok-123");
    expect(rows).toEqual([
      { bookId: "b1", clientVersion: "2026-01-01T00:00:00Z", deleted: false, updatedAt: "2026-01-01T00:00:00Z" },
    ]);
  });

  it("putBook sends base64 ciphertext/nonce/wrapped_dk/dk_nonce and the raw client_version", async () => {
    const ct = bytes(64, 3), nonce = bytes(12, 5), wdk = bytes(48, 7), dkn = bytes(12, 9);
    mockResponse({
      book_id: "b1",
      ciphertext: bytesToBase64(ct),
      nonce: bytesToBase64(nonce),
      wrapped_dk: bytesToBase64(wdk),
      dk_nonce: bytesToBase64(dkn),
      client_version: "2026-02-02T00:00:00Z",
      deleted: false,
      updated_at: "2026-02-02T00:00:00Z",
    });

    await syncClient.putBook("tok-123", "b1", {
      ciphertext: ct, nonce, wrappedDk: wdk, dkNonce: dkn, clientVersion: "2026-02-02T00:00:00Z",
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/sync/books/b1");
    const sent = JSON.parse(init.body);
    expect(sent.ciphertext).toBe(bytesToBase64(ct));
    expect(sent.client_version).toBe("2026-02-02T00:00:00Z");
  });

  it("getBook decodes all byte fields", async () => {
    const ct = bytes(64, 3), nonce = bytes(12, 5), wdk = bytes(48, 7), dkn = bytes(12, 9);
    mockResponse({
      book_id: "b1",
      ciphertext: bytesToBase64(ct),
      nonce: bytesToBase64(nonce),
      wrapped_dk: bytesToBase64(wdk),
      dk_nonce: bytesToBase64(dkn),
      client_version: "2026-02-02T00:00:00Z",
      deleted: false,
      updated_at: "2026-02-02T00:00:00Z",
    });
    const b = await syncClient.getBook("tok-123", "b1");
    expect(b.ciphertext).toEqual(ct);
    expect(b.nonce).toEqual(nonce);
    expect(b.wrappedDk).toEqual(wdk);
    expect(b.dkNonce).toEqual(dkn);
  });

  it("deleteBook issues a DELETE and resolves on 204", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204, text: async () => "" });
    await expect(syncClient.deleteBook("tok-123", "b1")).resolves.toBeUndefined();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/sync/books/b1");
    expect(init.method).toBe("DELETE");
  });

  it("getKeyset surfaces a 404 (no keyset yet) as ApiError", async () => {
    mockResponse({ detail: "no keyset for this account" }, 404);
    await expect(syncClient.getKeyset("tok-123")).rejects.toMatchObject({ status: 404 });
  });
});
