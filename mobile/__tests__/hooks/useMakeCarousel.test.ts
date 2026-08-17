import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useMakeCarousel } from "@/hooks/useMakeCarousel";
import { ApiError } from "@/api/client";
import * as client from "@/api/derivativesClient";
import { useBillingPlan } from "@/hooks/useBillingPlan";

jest.mock("@/api/derivativesClient", () => ({ makeCarousel: jest.fn() }));
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: jest.fn() }));
const makeCarousel = client.makeCarousel as jest.Mock;

const CAROUSEL_RESULT = {
  frames: [
    { card: { headline: "Frame one", subtext: "First frame body.", source_label: "Stormwater 101" }, image_png_base64: "AAA" },
    { card: { headline: "Frame two", subtext: "Second frame body.", source_label: "Stormwater 101" }, image_png_base64: "BBB" },
  ],
  provenance: "ai-generated",
};

beforeEach(() => {
  jest.clearAllMocks();
  // Fail-open default (matches the other useBillingPlan consumers) — most
  // tests here don't care about Pro/Free, only the keyless-when-Pro suite
  // below overrides this per-case.
  (useBillingPlan as jest.Mock).mockReturnValue({ plan: null, loading: false });
});

it("sends the key, source text and tone (no size), then exposes the result on success", async () => {
  makeCarousel.mockResolvedValue(CAROUSEL_RESULT);
  const getApiKey = jest.fn().mockResolvedValue("sk-ant-xxxxxxxxxxxxxxxxxxxx");
  const { result } = renderHook(() => useMakeCarousel({ getApiKey }));

  await act(async () => {
    await result.current.run({ source_text: "Stormwater.", tone: "punchy" });
  });

  expect(makeCarousel).toHaveBeenCalledWith(
    expect.objectContaining({
      source_text: "Stormwater.",
      tone: "punchy",
      api_key: "sk-ant-xxxxxxxxxxxxxxxxxxxx",
      provider_id: "anthropic",
    }),
  );
  const sent = makeCarousel.mock.calls[0][0];
  expect("size" in sent).toBe(false);
  await waitFor(() => expect(result.current.status).toBe("done"));
  expect(result.current.result).toEqual(CAROUSEL_RESULT);
});

it("sends topic_version_id instead of source_text when given", async () => {
  makeCarousel.mockResolvedValue(CAROUSEL_RESULT);
  const getApiKey = jest.fn().mockResolvedValue("sk-ant-xxxxxxxxxxxxxxxxxxxx");
  const { result } = renderHook(() => useMakeCarousel({ getApiKey }));

  await act(async () => {
    await result.current.run({ topic_version_id: "tv-1" });
  });

  const sent = makeCarousel.mock.calls[0][0];
  expect(sent.topic_version_id).toBe("tv-1");
  expect("source_text" in sent).toBe(false);
  expect("size" in sent).toBe(false);
});

it("fails without calling makeCarousel when no key is saved and known not-Pro", async () => {
  (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: false }, loading: false });
  const getApiKey = jest.fn().mockResolvedValue(null);
  const { result } = renderHook(() => useMakeCarousel({ getApiKey }));
  await act(async () => {
    await result.current.run({ source_text: "x" });
  });
  expect(makeCarousel).not.toHaveBeenCalled();
  await waitFor(() => expect(result.current.status).toBe("failed"));
  expect(result.current.error).toMatch(/api key/i);
});

describe("keyless-when-Pro wiring", () => {
  it("no saved key + Pro sends a keyless request (no api_key) and sets no error", async () => {
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: true }, loading: false });
    makeCarousel.mockResolvedValue(CAROUSEL_RESULT);
    const getApiKey = jest.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useMakeCarousel({ getApiKey }));

    await act(async () => {
      await result.current.run({ source_text: "Stormwater." });
    });

    expect(makeCarousel).toHaveBeenCalledTimes(1);
    const sent = makeCarousel.mock.calls[0][0];
    expect("api_key" in sent).toBe(false);
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.error).toBeNull();
  });

  it("no saved key + plan still loading (null) sends a keyless request (fail-open)", async () => {
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: null, loading: true });
    makeCarousel.mockResolvedValue(CAROUSEL_RESULT);
    const getApiKey = jest.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useMakeCarousel({ getApiKey }));

    await act(async () => {
      await result.current.run({ source_text: "Stormwater." });
    });

    expect(makeCarousel).toHaveBeenCalledTimes(1);
    expect("api_key" in makeCarousel.mock.calls[0][0]).toBe(false);
  });

  it("a saved key is always sent as BYOK, regardless of plan", async () => {
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: false }, loading: false });
    makeCarousel.mockResolvedValue(CAROUSEL_RESULT);
    const getApiKey = jest.fn().mockResolvedValue("sk-ant-xxxxxxxxxxxxxxxxxxxx");
    const { result } = renderHook(() => useMakeCarousel({ getApiKey }));

    await act(async () => {
      await result.current.run({ source_text: "Stormwater." });
    });

    expect(makeCarousel.mock.calls[0][0].api_key).toBe("sk-ant-xxxxxxxxxxxxxxxxxxxx");
  });
});

it("surfaces ApiError.userMessage on failure", async () => {
  makeCarousel.mockRejectedValue(new ApiError(502, JSON.stringify({ detail: "generated content failed validation" })));
  const getApiKey = jest.fn().mockResolvedValue("sk-ant-xxxxxxxxxxxxxxxxxxxx");
  const { result } = renderHook(() => useMakeCarousel({ getApiKey }));
  await act(async () => {
    await result.current.run({ source_text: "x" });
  });
  await waitFor(() => expect(result.current.status).toBe("failed"));
  expect(result.current.error).toBe("generated content failed validation");
});
