import { generateVersion } from "@/api/trustClient";

function mockFetchOnce(status: number, body: unknown) {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300, status,
    json: async () => body, text: async () => JSON.stringify(body),
    headers: { get: () => null },
  });
}
afterEach(() => jest.restoreAllMocks());

it("POSTs a generate request with the JWT and returns the created version", async () => {
  const created = { id: "v1", artifact_id: "a1", version_no: 1, created_at: null };
  mockFetchOnce(200, created);
  const out = await generateVersion("a1", { api_key: "sk-ant-test", provider_id: "anthropic" }, "tok");
  expect(out.id).toBe("v1");
  const [url, init] = (global as unknown as { fetch: jest.Mock }).fetch.mock.calls[0];
  expect(url).toMatch(/\/trust\/artifacts\/a1\/versions\/generate$/);
  expect(init.method).toBe("POST");
  expect(init.headers.Authorization).toBe("Bearer tok");
  expect(JSON.parse(init.body)).toMatchObject({ api_key: "sk-ant-test", provider_id: "anthropic" });
});

it("includes guidance in the request body when provided", async () => {
  const created = { id: "v2", artifact_id: "a1", version_no: 2, created_at: null };
  mockFetchOnce(200, created);
  await generateVersion("a1", { api_key: "sk-ant-test", provider_id: "anthropic", guidance: "focus on cost" }, "tok");
  const [, init] = (global as unknown as { fetch: jest.Mock }).fetch.mock.calls[0];
  expect(JSON.parse(init.body).guidance).toBe("focus on cost");
});
