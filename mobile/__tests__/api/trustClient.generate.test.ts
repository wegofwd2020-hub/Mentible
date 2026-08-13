import { generateVersion } from "@/api/trustClient";

function mockFetchOnce(status: number, body: unknown) {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300, status,
    json: async () => body, text: async () => JSON.stringify(body),
    headers: { get: () => null },
  });
}
afterEach(() => jest.restoreAllMocks());

it("POSTs a generate request with the JWT and returns the job handle (202)", async () => {
  const job = { job_id: "job-1", status: "queued" };
  mockFetchOnce(202, job);
  const out = await generateVersion("a1", { api_key: "sk-ant-test", provider_id: "anthropic" }, "tok");
  expect(out).toEqual(job);
  const [url, init] = (global as unknown as { fetch: jest.Mock }).fetch.mock.calls[0];
  expect(url).toMatch(/\/trust\/artifacts\/a1\/versions\/generate$/);
  expect(init.method).toBe("POST");
  expect(init.headers.Authorization).toBe("Bearer tok");
  expect(JSON.parse(init.body)).toMatchObject({ api_key: "sk-ant-test", provider_id: "anthropic" });
});

it("includes guidance in the request body when provided", async () => {
  mockFetchOnce(202, { job_id: "job-2", status: "queued" });
  await generateVersion("a1", { api_key: "sk-ant-test", provider_id: "anthropic", guidance: "focus on cost" }, "tok");
  const [, init] = (global as unknown as { fetch: jest.Mock }).fetch.mock.calls[0];
  expect(JSON.parse(init.body).guidance).toBe("focus on cost");
});

// The shared GET /api/v1/jobs/{id} poll (formerly trustClient.getGenerateVersionJob)
// moved to the shared @/api/pollJob (see __tests__/api/pollJob.test.ts) — no
// per-hook getter remains here to test.
