import { makeAudio, makeCard, makeCarousel, makePost } from "@/api/derivativesClient";
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

it("makePost sends the image in the body when provided", async () => {
  mockFetchOnce(200, RESPONSE);
  await makePost({
    source_text: "s",
    platform: "linkedin",
    api_key: "sk-ant-x",
    image: { media_type: "image/png", data: "AAA" },
  });
  const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
  const [, init] = fetchMock.mock.calls[0];
  const sentBody = JSON.parse(init.body);
  expect(sentBody.image).toEqual({ media_type: "image/png", data: "AAA" });
});

const CARD_RESPONSE = {
  card: { headline: "Detention basins", subtext: "The short version.", source_label: "Stormwater 101" },
  size: "square",
  image_png_base64: "AAA",
  provenance: "ai-generated",
};

it("POSTs to /derivatives/card with the exact body and returns the parsed response", async () => {
  mockFetchOnce(200, CARD_RESPONSE);
  const out = await makeCard({
    source_text: "Stormwater basics.",
    size: "square",
    tone: "punchy",
    api_key: "sk-ant-xxxxxxxxxxxxxxxxxxxx",
    provider_id: "anthropic",
  });
  expect(out.card.headline).toBe("Detention basins");
  expect(out.image_png_base64).toBe("AAA");
  const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toMatch(/\/api\/v1\/derivatives\/card$/);
  expect(init.method).toBe("POST");
  const sent = JSON.parse(init.body);
  expect(sent.source_text).toBe("Stormwater basics.");
  expect(sent.size).toBe("square");
  expect(sent.api_key).toBe("sk-ant-xxxxxxxxxxxxxxxxxxxx");
});

it("makeCard sends topic_version_id instead of source_text when given", async () => {
  mockFetchOnce(200, CARD_RESPONSE);
  await makeCard({ topic_version_id: "tv-1", size: "story", api_key: "sk-ant-x" });
  const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
  const [, init] = fetchMock.mock.calls[0];
  const sent = JSON.parse(init.body);
  expect(sent.topic_version_id).toBe("tv-1");
  expect("source_text" in sent).toBe(false);
});

it("makeCard throws ApiError on a non-2xx response", async () => {
  mockFetchOnce(502, { detail: "generated content failed validation" });
  await expect(
    makeCard({ source_text: "x", size: "square", api_key: "sk-ant-x" }),
  ).rejects.toBeInstanceOf(ApiError);
});

const CAROUSEL_RESPONSE = {
  frames: [
    { card: { headline: "Frame one", subtext: "First frame body.", source_label: "Stormwater 101" }, image_png_base64: "AAA" },
    { card: { headline: "Frame two", subtext: "Second frame body.", source_label: "Stormwater 101" }, image_png_base64: "BBB" },
  ],
  provenance: "ai-generated",
};

it("POSTs to /derivatives/carousel with the exact body and returns the parsed response", async () => {
  mockFetchOnce(200, CAROUSEL_RESPONSE);
  const out = await makeCarousel({
    source_text: "Stormwater basics.",
    tone: "punchy",
    api_key: "sk-ant-xxxxxxxxxxxxxxxxxxxx",
    provider_id: "anthropic",
  });
  expect(out.frames).toHaveLength(2);
  expect(out.provenance).toBe("ai-generated");
  const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toMatch(/\/api\/v1\/derivatives\/carousel$/);
  expect(init.method).toBe("POST");
  const sent = JSON.parse(init.body);
  expect(sent.source_text).toBe("Stormwater basics.");
  expect(sent.tone).toBe("punchy");
  expect(sent.api_key).toBe("sk-ant-xxxxxxxxxxxxxxxxxxxx");
  expect("size" in sent).toBe(false);
});

it("makeCarousel sends topic_version_id instead of source_text when given", async () => {
  mockFetchOnce(200, CAROUSEL_RESPONSE);
  await makeCarousel({ topic_version_id: "tv-1", api_key: "sk-ant-x" });
  const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
  const [, init] = fetchMock.mock.calls[0];
  const sent = JSON.parse(init.body);
  expect(sent.topic_version_id).toBe("tv-1");
  expect("source_text" in sent).toBe(false);
});

it("makeCarousel throws ApiError on a non-2xx response", async () => {
  mockFetchOnce(502, { detail: "generated content failed validation" });
  await expect(
    makeCarousel({ source_text: "x", api_key: "sk-ant-x" }),
  ).rejects.toBeInstanceOf(ApiError);
});

it("makeCarousel throws in a demo build without hitting the network", async () => {
  jest.resetModules();
  jest.doMock("@/constants/demo", () => ({ IS_DEMO: true }));
  const fetchMock = jest.fn();
  (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  const { makeCarousel: makeCarouselInDemo } = require("@/api/derivativesClient") as typeof import("@/api/derivativesClient");
  await expect(makeCarouselInDemo({ source_text: "x" })).rejects.toThrow(/demo/i);
  expect(fetchMock).not.toHaveBeenCalled();
  jest.dontMock("@/constants/demo");
  jest.resetModules();
});

const AUDIO_RESPONSE = {
  script: "Water finds the lowest point.",
  title: "Stormwater, decoded",
  audio_base64: "SUQzZmFrZQ==",
  mime: "audio/mpeg",
  provenance: "ai-generated",
};

it("POSTs to /derivatives/audio with the exact body and returns the parsed response", async () => {
  mockFetchOnce(200, AUDIO_RESPONSE);
  const out = await makeAudio({
    source_text: "Stormwater basics.",
    tone: "warm",
    api_key: "sk-xxxxxxxxxxxxxxxxxxxx",
    provider_id: "openai",
  });
  expect(out.title).toBe("Stormwater, decoded");
  expect(out.mime).toBe("audio/mpeg");
  const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toMatch(/\/api\/v1\/derivatives\/audio$/);
  expect(init.method).toBe("POST");
  const sent = JSON.parse(init.body);
  expect(sent.source_text).toBe("Stormwater basics.");
  expect(sent.tone).toBe("warm");
  expect(sent.provider_id).toBe("openai");
  expect(sent.api_key).toBe("sk-xxxxxxxxxxxxxxxxxxxx");
});

it("makeAudio defaults provider_id to openai when omitted", async () => {
  mockFetchOnce(200, AUDIO_RESPONSE);
  await makeAudio({ source_text: "x", api_key: "sk-xxxxxxxxxxxxxxxxxxxx" });
  const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
  const [, init] = fetchMock.mock.calls[0];
  expect(JSON.parse(init.body).provider_id).toBe("openai");
});

it("makeAudio sends topic_version_id instead of source_text when given", async () => {
  mockFetchOnce(200, AUDIO_RESPONSE);
  await makeAudio({ topic_version_id: "tv-1", api_key: "sk-x" });
  const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
  const [, init] = fetchMock.mock.calls[0];
  const sent = JSON.parse(init.body);
  expect(sent.topic_version_id).toBe("tv-1");
  expect("source_text" in sent).toBe(false);
});

it("makeAudio throws ApiError on a non-2xx response", async () => {
  mockFetchOnce(422, { detail: "audio narration is not available for anthropic" });
  await expect(
    makeAudio({ source_text: "x", api_key: "sk-x" }),
  ).rejects.toBeInstanceOf(ApiError);
});

it("makeAudio throws in a demo build without hitting the network", async () => {
  jest.resetModules();
  jest.doMock("@/constants/demo", () => ({ IS_DEMO: true }));
  const fetchMock = jest.fn();
  (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  const { makeAudio: demoMakeAudio } = await import("@/api/derivativesClient");
  await expect(demoMakeAudio({ source_text: "x" })).rejects.toThrow(/demo/i);
  expect(fetchMock).not.toHaveBeenCalled();
});
