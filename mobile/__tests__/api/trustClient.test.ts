import { syncSession, getProject, approveVersion, withdrawApproval, addFeedback, suggestToc, generateVersion, generateTopic, estimateBook, generateBook, getGenerationJob, latestGenerationJob } from "@/api/trustClient";

const okJson = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);

beforeEach(() => { jest.restoreAllMocks(); });

it("syncSession POSTs with the bearer token and returns memberships", async () => {
  const spy = jest.spyOn(global, "fetch").mockImplementation(() =>
    okJson({ account_id: "a", email: "e@x.z", memberships: [{ project_id: "p1", role: "reviewer" }] }));
  const out = await syncSession("tok");
  expect(out.memberships).toEqual([{ project_id: "p1", role: "reviewer" }]);
  const [url, init] = spy.mock.calls[0];
  expect(String(url)).toContain("/api/v1/trust/session/sync");
  expect((init as RequestInit).method).toBe("POST");
  expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });
});

it("approveVersion POSTs the body and returns the approval", async () => {
  const spy = jest.spyOn(global, "fetch").mockImplementation(() =>
    okJson({ id: "ap", version_id: "v1", expert_name: "e@x.z", approved_at: "t", recorded_via: "expert_self" }));
  const out = await approveVersion("v1", { approved_at: "t" }, "tok");
  expect(out.recorded_via).toBe("expert_self");
  const [url, init] = spy.mock.calls[0];
  expect(String(url)).toContain("/api/v1/trust/versions/v1/approvals");
  expect((init as RequestInit).method).toBe("POST");
  expect((init as RequestInit).body).toBe(JSON.stringify({ approved_at: "t" }));
});

it("withdrawApproval POSTs to the withdraw endpoint and returns the record", async () => {
  const spy = jest.spyOn(global, "fetch").mockImplementation(() =>
    okJson({ id: "ap2", version_id: "v1", expert_name: "e@x.z", approved_at: "t", recorded_via: "expert_self", action: "withdraw" }));
  const out = await withdrawApproval("v1", { note: "changed my mind" }, "tok");
  expect(out.action).toBe("withdraw");
  const [url, init] = spy.mock.calls[0];
  expect(String(url)).toContain("/api/v1/trust/versions/v1/approvals/withdraw");
  expect((init as RequestInit).method).toBe("POST");
  expect((init as RequestInit).body).toBe(JSON.stringify({ note: "changed my mind" }));
});

it("addFeedback POSTs the note to the feedback endpoint", async () => {
  const spy = jest.spyOn(global, "fetch").mockImplementation(() =>
    okJson({ id: "f1", version_id: "v1", author_kind: "expert", author_name: "Dr X", body: "tighten intro", created_at: null }));
  const out = await addFeedback("v1", { body: "tighten intro" }, "tok");
  expect(out.author_kind).toBe("expert");
  const [url, init] = spy.mock.calls[0];
  expect(String(url)).toContain("/api/v1/trust/versions/v1/feedback");
  expect((init as RequestInit).method).toBe("POST");
  expect((init as RequestInit).body).toBe(JSON.stringify({ body: "tighten intro" }));
});

it("throws ApiError on a non-ok response", async () => {
  jest.spyOn(global, "fetch").mockImplementation(() =>
    Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve("no access") } as Response));
  await expect(getProject("p1", "tok")).rejects.toMatchObject({ status: 403 });
});

describe("keyless generation", () => {
  it("suggestToc without api_key omits it from the POST body", async () => {
    const spy = jest.spyOn(global, "fetch").mockImplementation(() =>
      okJson({ job_id: "j1", status: "queued" }));
    await suggestToc("p1", { provider_id: "anthropic" }, "tok");
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ provider_id: "anthropic" });
    expect(body).not.toHaveProperty("api_key");
  });

  it("suggestToc with api_key includes it in the POST body", async () => {
    const spy = jest.spyOn(global, "fetch").mockImplementation(() =>
      okJson({ job_id: "j1", status: "queued" }));
    const apiKey = "sk-ant-" + "x".repeat(20);
    await suggestToc("p1", { api_key: apiKey, provider_id: "anthropic" }, "tok");
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ api_key: apiKey, provider_id: "anthropic" });
    expect(body).toHaveProperty("api_key", apiKey);
  });

  it("generateVersion without api_key omits it from the POST body", async () => {
    const spy = jest.spyOn(global, "fetch").mockImplementation(() =>
      okJson({ job_id: "j1", status: "queued" }));
    await generateVersion("a1", { provider_id: "anthropic" }, "tok");
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ provider_id: "anthropic" });
    expect(body).not.toHaveProperty("api_key");
  });

  it("generateVersion with api_key includes it in the POST body", async () => {
    const spy = jest.spyOn(global, "fetch").mockImplementation(() =>
      okJson({ job_id: "j1", status: "queued" }));
    const apiKey = "sk-ant-" + "x".repeat(20);
    await generateVersion("a1", { api_key: apiKey, provider_id: "anthropic" }, "tok");
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ api_key: apiKey, provider_id: "anthropic" });
    expect(body).toHaveProperty("api_key", apiKey);
  });

  it("generateTopic without api_key omits it from the POST body", async () => {
    const spy = jest.spyOn(global, "fetch").mockImplementation(() =>
      okJson({ job_id: "j1", status: "queued" }));
    await generateTopic("p1", "t1", { provider_id: "anthropic" }, "tok");
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ provider_id: "anthropic" });
    expect(body).not.toHaveProperty("api_key");
  });

  it("generateTopic with api_key includes it in the POST body", async () => {
    const spy = jest.spyOn(global, "fetch").mockImplementation(() =>
      okJson({ job_id: "j1", status: "queued" }));
    const apiKey = "sk-ant-" + "x".repeat(20);
    await generateTopic("p1", "t1", { api_key: apiKey, provider_id: "anthropic" }, "tok");
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ api_key: apiKey, provider_id: "anthropic" });
    expect(body).toHaveProperty("api_key", apiKey);
  });

  it("generateBook without apiKey omits api_key from the POST body", async () => {
    const spy = jest.spyOn(global, "fetch").mockImplementation(() =>
      okJson({ job_id: "j1", total: 3 }));
    await generateBook("p1", "tok");
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({});
    expect(body).not.toHaveProperty("api_key");
  });

  it("generateBook with apiKey includes api_key in the POST body", async () => {
    const spy = jest.spyOn(global, "fetch").mockImplementation(() =>
      okJson({ job_id: "j1", total: 3 }));
    const apiKey = "sk-ant-" + "x".repeat(20);
    await generateBook("p1", "tok", { apiKey });
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ api_key: apiKey });
  });
});

describe("generate-book estimate + job status", () => {
  it("estimateBook GETs the estimate endpoint and returns the estimate", async () => {
    const spy = jest.spyOn(global, "fetch").mockImplementation(() =>
      okJson({
        missing_topics: 3, est_input_tokens: 1200, est_output_tokens_max: 24576,
        est_cost_micros_max: 450000, remaining_micros: 100000, would_exceed: true,
      }));
    const out = await estimateBook("p1", "tok");
    expect(out).toEqual({
      missing_topics: 3, est_input_tokens: 1200, est_output_tokens_max: 24576,
      est_cost_micros_max: 450000, remaining_micros: 100000, would_exceed: true,
    });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/api/v1/trust/projects/p1/generate-book/estimate");
    expect(init.method).toBe("GET");
  });

  it("generateBook POSTs to the generate-book endpoint and returns the job handle", async () => {
    const spy = jest.spyOn(global, "fetch").mockImplementation(() =>
      okJson({ job_id: "j1", total: 3 }));
    const out = await generateBook("p1", "tok");
    expect(out).toEqual({ job_id: "j1", total: 3 });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/api/v1/trust/projects/p1/generate-book");
    expect(init.method).toBe("POST");
  });

  it("getGenerationJob GETs the generation-jobs endpoint", async () => {
    const spy = jest.spyOn(global, "fetch").mockImplementation(() =>
      okJson({ id: "j1", project_id: "p1", status: "running", total: 3, done: 1, failed_topic_ids: [], created_at: null }));
    const out = await getGenerationJob("j1", "tok");
    expect(out.status).toBe("running");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/api/v1/trust/generation-jobs/j1");
    expect(init.method).toBe("GET");
  });

  it("latestGenerationJob GETs the project's latest generation job", async () => {
    const spy = jest.spyOn(global, "fetch").mockImplementation(() =>
      okJson({ id: "j1", project_id: "p1", status: "done", total: 3, done: 3, failed_topic_ids: [], created_at: null }));
    const out = await latestGenerationJob("p1", "tok");
    expect(out?.id).toBe("j1");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/api/v1/trust/projects/p1/generation-jobs/latest");
    expect(init.method).toBe("GET");
  });

  it("latestGenerationJob returns null when the project has no generation job yet", async () => {
    jest.spyOn(global, "fetch").mockImplementation(() => okJson(null));
    const out = await latestGenerationJob("p1", "tok");
    expect(out).toBeNull();
  });
});
