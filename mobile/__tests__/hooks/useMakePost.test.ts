import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useMakePost } from "@/hooks/useMakePost";
import { ApiError } from "@/api/client";
import * as client from "@/api/derivativesClient";

jest.mock("@/api/derivativesClient", () => ({ makePost: jest.fn() }));
const makePost = client.makePost as jest.Mock;

const VARIANTS = [
  { hook: "h0", body: "b0", hashtags: ["#a"], cta: null },
  { hook: "h1", body: "b1", hashtags: ["#a"], cta: null },
  { hook: "h2", body: "b2", hashtags: ["#a"], cta: null },
];

beforeEach(() => jest.clearAllMocks());

it("sends the key and platform, then exposes the variants on success", async () => {
  makePost.mockResolvedValue({ platform: "linkedin", variants: VARIANTS, provenance: "ai-generated" });
  const getApiKey = jest.fn().mockResolvedValue("sk-ant-xxxxxxxxxxxxxxxxxxxx");
  const { result } = renderHook(() => useMakePost({ getApiKey }));

  await act(async () => {
    await result.current.run({ sourceText: "Stormwater.", platform: "linkedin", tone: "punchy" });
  });

  expect(makePost).toHaveBeenCalledWith(
    expect.objectContaining({
      source_text: "Stormwater.",
      platform: "linkedin",
      tone: "punchy",
      api_key: "sk-ant-xxxxxxxxxxxxxxxxxxxx",
      provider_id: "anthropic",
    }),
  );
  await waitFor(() => expect(result.current.status).toBe("done"));
  expect(result.current.variants).toHaveLength(3);
  expect(result.current.provenance).toBe("ai-generated");
});

it("fails without calling makePost when no key is saved", async () => {
  const getApiKey = jest.fn().mockResolvedValue(null);
  const { result } = renderHook(() => useMakePost({ getApiKey }));
  await act(async () => {
    await result.current.run({ sourceText: "x", platform: "x" });
  });
  expect(makePost).not.toHaveBeenCalled();
  await waitFor(() => expect(result.current.status).toBe("failed"));
  expect(result.current.error).toMatch(/api key/i);
});

it("surfaces ApiError.userMessage on failure", async () => {
  makePost.mockRejectedValue(new ApiError(502, JSON.stringify({ detail: "generated content failed validation" })));
  const getApiKey = jest.fn().mockResolvedValue("sk-ant-xxxxxxxxxxxxxxxxxxxx");
  const { result } = renderHook(() => useMakePost({ getApiKey }));
  await act(async () => {
    await result.current.run({ sourceText: "x", platform: "linkedin" });
  });
  await waitFor(() => expect(result.current.status).toBe("failed"));
  expect(result.current.error).toBe("generated content failed validation");
});
