import { generateVersion, getGenerateVersionJob } from "@/api/trustClient";

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

it("getGenerateVersionJob GETs the SHARED (non-/trust) /jobs/{id} route and returns status+result", async () => {
  const done = { status: "done", result: { version_id: "v1", artifact_id: "a1", version_no: 3 } };
  mockFetchOnce(200, done);
  const out = await getGenerateVersionJob("job-1", "tok");
  expect(out).toEqual(done);
  const [url, init] = (global as unknown as { fetch: jest.Mock }).fetch.mock.calls[0];
  expect(url).toMatch(/\/api\/v1\/jobs\/job-1$/);
  expect(url).not.toMatch(/\/trust\//);
  expect(init.headers.Authorization).toBe("Bearer tok");
});

it("getGenerateVersionJob throws an ApiError on a non-OK response", async () => {
  mockFetchOnce(404, { detail: "job not found" });
  await expect(getGenerateVersionJob("missing", "tok")).rejects.toMatchObject({ status: 404 });
});
