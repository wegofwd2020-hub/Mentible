import { generateTopic, getJob, getTopicVersion, recordTopicApproval, withdrawTopicApproval } from "@/api/trustClient";

function mockFetchOnce(status: number, body: unknown) {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300, status,
    json: async () => body, text: async () => JSON.stringify(body),
    headers: { get: () => null },
  });
}
afterEach(() => jest.restoreAllMocks());

it("generateTopic POSTs to the per-topic generate route and returns the 202 job handle (Phase A async)", async () => {
  const accepted = { job_id: "job-1", status: "queued" };
  mockFetchOnce(202, accepted);
  const out = await generateTopic("p1", "t1", { api_key: "sk-ant-test", provider_id: "anthropic" }, "tok");
  expect(out).toEqual({ job_id: "job-1", status: "queued" });
  const [url, init] = (global as unknown as { fetch: jest.Mock }).fetch.mock.calls[0];
  expect(url).toMatch(/\/trust\/projects\/p1\/topics\/t1\/generate$/);
  expect(init.method).toBe("POST");
  expect(init.headers.Authorization).toBe("Bearer tok");
  expect(JSON.parse(init.body)).toMatchObject({ api_key: "sk-ant-test", provider_id: "anthropic" });
});

it("getJob GETs the SHARED (non-/trust) /jobs/{id} route and returns status+result", async () => {
  const done = { status: "done", result: { version_id: "tv1", topic_id: "t1", version_no: 2 } };
  mockFetchOnce(200, done);
  const out = await getJob("job-1", "tok");
  expect(out).toEqual(done);
  const [url, init] = (global as unknown as { fetch: jest.Mock }).fetch.mock.calls[0];
  expect(url).toMatch(/\/api\/v1\/jobs\/job-1$/);
  expect(url).not.toMatch(/\/trust\//);
  expect(init.headers.Authorization).toBe("Bearer tok");
});

it("getJob throws an ApiError on a non-OK response", async () => {
  mockFetchOnce(404, { detail: "job not found" });
  await expect(getJob("missing", "tok")).rejects.toMatchObject({ status: 404 });
});

it("getTopicVersion GETs the topic version and returns its content", async () => {
  const payload = {
    id: "tv1", topic_id: "t1", title: "Intro", version_no: 1, created_at: null,
    content: { sections: [{ heading: "H", body: "B", source_ids: [] }] },
    is_validated: false, recorded_via: null,
  };
  mockFetchOnce(200, payload);
  const v = await getTopicVersion("tv1", "tok");
  expect(v.content.sections[0].heading).toBe("H");
  const [url, init] = (global as unknown as { fetch: jest.Mock }).fetch.mock.calls[0];
  expect(url).toMatch(/\/trust\/topic-versions\/tv1$/);
  expect(init.method).toBe("GET");
});

it("recordTopicApproval POSTs to the per-topic approvals route and returns topic_version_id", async () => {
  const approval = { id: "ap1", topic_version_id: "tv1", expert_name: "e", approved_at: "t", recorded_via: "expert_self" };
  mockFetchOnce(200, approval);
  const out = await recordTopicApproval("tv1", { approved_at: "t", expert_name: "e" }, "tok");
  expect(out.id).toBe("ap1");
  expect(out.topic_version_id).toBe("tv1");
  const [url, init] = (global as unknown as { fetch: jest.Mock }).fetch.mock.calls[0];
  expect(url).toMatch(/\/trust\/topic-versions\/tv1\/approvals$/);
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body)).toMatchObject({ approved_at: "t", expert_name: "e" });
});

it("withdrawTopicApproval POSTs to the per-topic approvals/withdraw route and returns topic_version_id", async () => {
  const approval = { id: "ap1", topic_version_id: "tv1", expert_name: "e", approved_at: "t", recorded_via: "expert_self", action: "withdraw" };
  mockFetchOnce(200, approval);
  const out = await withdrawTopicApproval("tv1", {}, "tok");
  expect(out.topic_version_id).toBe("tv1");
  const [url, init] = (global as unknown as { fetch: jest.Mock }).fetch.mock.calls[0];
  expect(url).toMatch(/\/trust\/topic-versions\/tv1\/approvals\/withdraw$/);
  expect(init.method).toBe("POST");
});
