import { syncSession, getProject, approveVersion, withdrawApproval, addFeedback, suggestToc, generateVersion, generateTopic } from "@/api/trustClient";

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
});
