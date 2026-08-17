import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useMakeAnimated } from "@/hooks/useMakeAnimated";
import { ApiError } from "@/api/client";
import * as client from "@/api/derivativesClient";
import { useBillingPlan } from "@/hooks/useBillingPlan";

jest.mock("@/api/derivativesClient", () => ({ makeAnimated: jest.fn() }));
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: jest.fn() }));
const makeAnimated = client.makeAnimated as jest.Mock;

const ANIMATED_RESULT = {
  card: { headline: "Detention basins", subtext: "The short version.", source_label: "Stormwater 101" },
  preset: "fade",
  image_gif_base64: "AAA",
  provenance: "ai-generated",
};

beforeEach(() => {
  jest.clearAllMocks();
  // Fail-open default (matches the other useBillingPlan consumers) — most
  // tests here don't care about Pro/Free, only the keyless-when-Pro suite
  // below overrides this per-case.
  (useBillingPlan as jest.Mock).mockReturnValue({ plan: null, loading: false });
});

it("sends the key, source text and preset, then exposes the result on success", async () => {
  makeAnimated.mockResolvedValue(ANIMATED_RESULT);
  const getApiKey = jest.fn().mockResolvedValue("sk-ant-xxxxxxxxxxxxxxxxxxxx");
  const { result } = renderHook(() => useMakeAnimated({ getApiKey }));

  await act(async () => {
    await result.current.run({ source_text: "Stormwater.", preset: "fade", tone: "punchy" });
  });

  expect(makeAnimated).toHaveBeenCalledWith(
    expect.objectContaining({
      source_text: "Stormwater.",
      preset: "fade",
      tone: "punchy",
      api_key: "sk-ant-xxxxxxxxxxxxxxxxxxxx",
      provider_id: "anthropic",
    }),
  );
  await waitFor(() => expect(result.current.status).toBe("done"));
  expect(result.current.result).toEqual(ANIMATED_RESULT);
});

it("sends topic_version_id instead of source_text when given", async () => {
  makeAnimated.mockResolvedValue(ANIMATED_RESULT);
  const getApiKey = jest.fn().mockResolvedValue("sk-ant-xxxxxxxxxxxxxxxxxxxx");
  const { result } = renderHook(() => useMakeAnimated({ getApiKey }));

  await act(async () => {
    await result.current.run({ topic_version_id: "tv-1", preset: "slide" });
  });

  const sent = makeAnimated.mock.calls[0][0];
  expect(sent.topic_version_id).toBe("tv-1");
  expect(sent.preset).toBe("slide");
  expect("source_text" in sent).toBe(false);
});

it("fails without calling makeAnimated when no key is saved and known not-Pro", async () => {
  (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: false }, loading: false });
  const getApiKey = jest.fn().mockResolvedValue(null);
  const { result } = renderHook(() => useMakeAnimated({ getApiKey }));
  await act(async () => {
    await result.current.run({ source_text: "x", preset: "fade" });
  });
  expect(makeAnimated).not.toHaveBeenCalled();
  await waitFor(() => expect(result.current.status).toBe("failed"));
  expect(result.current.error).toMatch(/api key/i);
});

describe("keyless-when-Pro wiring", () => {
  it("no saved key + Pro sends a keyless request (no api_key) and sets no error", async () => {
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: true }, loading: false });
    makeAnimated.mockResolvedValue(ANIMATED_RESULT);
    const getApiKey = jest.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useMakeAnimated({ getApiKey }));

    await act(async () => {
      await result.current.run({ source_text: "Stormwater.", preset: "fade" });
    });

    expect(makeAnimated).toHaveBeenCalledTimes(1);
    const sent = makeAnimated.mock.calls[0][0];
    expect("api_key" in sent).toBe(false);
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.error).toBeNull();
  });

  it("no saved key + plan still loading (null) sends a keyless request (fail-open)", async () => {
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: null, loading: true });
    makeAnimated.mockResolvedValue(ANIMATED_RESULT);
    const getApiKey = jest.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useMakeAnimated({ getApiKey }));

    await act(async () => {
      await result.current.run({ source_text: "Stormwater.", preset: "fade" });
    });

    expect(makeAnimated).toHaveBeenCalledTimes(1);
    expect("api_key" in makeAnimated.mock.calls[0][0]).toBe(false);
  });

  it("a saved key is always sent as BYOK, regardless of plan", async () => {
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: false }, loading: false });
    makeAnimated.mockResolvedValue(ANIMATED_RESULT);
    const getApiKey = jest.fn().mockResolvedValue("sk-ant-xxxxxxxxxxxxxxxxxxxx");
    const { result } = renderHook(() => useMakeAnimated({ getApiKey }));

    await act(async () => {
      await result.current.run({ source_text: "Stormwater.", preset: "fade" });
    });

    expect(makeAnimated.mock.calls[0][0].api_key).toBe("sk-ant-xxxxxxxxxxxxxxxxxxxx");
  });
});

it("surfaces ApiError.userMessage on failure", async () => {
  makeAnimated.mockRejectedValue(new ApiError(502, JSON.stringify({ detail: "generated content failed validation" })));
  const getApiKey = jest.fn().mockResolvedValue("sk-ant-xxxxxxxxxxxxxxxxxxxx");
  const { result } = renderHook(() => useMakeAnimated({ getApiKey }));
  await act(async () => {
    await result.current.run({ source_text: "x", preset: "fade" });
  });
  await waitFor(() => expect(result.current.status).toBe("failed"));
  expect(result.current.error).toBe("generated content failed validation");
});
