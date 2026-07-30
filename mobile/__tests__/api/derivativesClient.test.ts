import { makePost } from "@/api/derivativesClient";
import { ApiError } from "@/api/client";

const RESPONSE = {
  platform: "linkedin",
  variants: [
    { hook: "h0", body: "b0", hashtags: ["#a"], cta: null },
    { hook: "h1", body: "b1", hashtags: ["#a"], cta: "read more" },
    { hook: "h2", body: "b2", hashtags: ["#a"], cta: null },
  ],
  provenance: "ai-generated",
};

function mockFetchOnce(status: number, body: unknown) {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => null },
  });
}

afterEach(() => jest.restoreAllMocks());

it("POSTs to /derivatives/post with the exact body and returns the parsed response", async () => {
  mockFetchOnce(200, RESPONSE);
  const out = await makePost({
    source_text: "Stormwater basics.",
    platform: "linkedin",
    tone: "punchy",
    api_key: "sk-ant-xxxxxxxxxxxxxxxxxxxx",
    provider_id: "anthropic",
  });
  expect(out.variants).toHaveLength(3);
  expect(out.provenance).toBe("ai-generated");
  const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toMatch(/\/api\/v1\/derivatives\/post$/);
  expect(init.method).toBe("POST");
  const sent = JSON.parse(init.body);
  expect(sent.source_text).toBe("Stormwater basics.");
  expect(sent.platform).toBe("linkedin");
  expect(sent.api_key).toBe("sk-ant-xxxxxxxxxxxxxxxxxxxx");
  expect(sent.provider_id).toBe("anthropic");
});

it("throws ApiError on a non-2xx response", async () => {
  mockFetchOnce(502, { detail: "generated content failed validation" });
  await expect(
    makePost({ source_text: "x", platform: "x", api_key: "sk-ant-xxxxxxxxxxxxxxxxxxxx" }),
  ).rejects.toBeInstanceOf(ApiError);
});
