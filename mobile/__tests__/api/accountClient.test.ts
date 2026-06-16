import {
  deleteAccount,
  deleteCredential,
  getAccount,
  putCredential,
} from "../../src/api/accountClient";
import { ApiError } from "../../src/api/client";

global.fetch = jest.fn();
const mockFetch = global.fetch as jest.Mock;

beforeEach(() => jest.clearAllMocks());

function mockResponse(body: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

const TOKEN = "session-jwt-token";

function lastCall(): [string, RequestInit] {
  return mockFetch.mock.calls[0] as [string, RequestInit];
}

describe("getAccount", () => {
  it("GETs /api/v1/account with a Bearer token and returns the view", async () => {
    mockResponse({ sub: "u1", email: "a@x.com", credentials: [] });
    const acct = await getAccount(TOKEN);
    expect(acct.sub).toBe("u1");
    const [url, opts] = lastCall();
    expect(url).toContain("/api/v1/account");
    expect((opts.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });
});

describe("putCredential", () => {
  it("PUTs custody/status (no key) to the provider path", async () => {
    mockResponse({
      provider_id: "anthropic",
      source: "device_local",
      status: "valid",
      last_verified_at: null,
      updated_at: "2026-06-16T00:00:00Z",
    });
    const cred = await putCredential(TOKEN, "anthropic", { source: "device_local", status: "valid" });
    expect(cred.source).toBe("device_local");
    const [url, opts] = lastCall();
    expect(url).toContain("/api/v1/account/credentials/anthropic");
    expect(opts.method).toBe("PUT");
    const body = JSON.parse(opts.body as string);
    expect(body.source).toBe("device_local");
    expect(body).not.toHaveProperty("key"); // never send key material (D5)
  });

  it("url-encodes the provider id", async () => {
    mockResponse({
      provider_id: "weird/id",
      source: "device_local",
      status: "unverified",
      last_verified_at: null,
      updated_at: "2026-06-16T00:00:00Z",
    });
    await putCredential(TOKEN, "weird/id", { source: "device_local" });
    expect(lastCall()[0]).toContain("/credentials/weird%2Fid");
  });
});

describe("delete endpoints", () => {
  it("deleteCredential issues DELETE and tolerates 204 (no body)", async () => {
    mockResponse(null, 204);
    await expect(deleteCredential(TOKEN, "anthropic")).resolves.toBeUndefined();
    expect(lastCall()[1].method).toBe("DELETE");
  });

  it("deleteAccount issues DELETE on the account root (D8 purge)", async () => {
    mockResponse(null, 204);
    await deleteAccount(TOKEN);
    const [url, opts] = lastCall();
    expect(url).toMatch(/\/api\/v1\/account$/);
    expect(opts.method).toBe("DELETE");
  });
});

describe("errors", () => {
  it("throws ApiError on a non-2xx response", async () => {
    mockResponse({ detail: "nope" }, 401);
    await expect(getAccount(TOKEN)).rejects.toBeInstanceOf(ApiError);
  });
});
