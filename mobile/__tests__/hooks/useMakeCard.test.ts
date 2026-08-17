import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useMakeCard } from "@/hooks/useMakeCard";
import { ApiError } from "@/api/client";
import * as client from "@/api/derivativesClient";
import { useBillingPlan } from "@/hooks/useBillingPlan";

jest.mock("@/api/derivativesClient", () => ({ makeCard: jest.fn() }));
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: jest.fn() }));
const makeCard = client.makeCard as jest.Mock;

const CARD_RESULT = {
  card: { headline: "Detention basins", subtext: "The short version.", source_label: "Stormwater 101" },
  size: "square",
  image_png_base64: "AAA",
  provenance: "ai-generated",
};

beforeEach(() => {
  jest.clearAllMocks();
  // Fail-open default (matches the other useBillingPlan consumers) — most
  // tests here don't care about Pro/Free, only the keyless-when-Pro suite
  // below overrides this per-case.
  (useBillingPlan as jest.Mock).mockReturnValue({ plan: null, loading: false });
});

it("sends the key, source text and size, then exposes the result on success", async () => {
  makeCard.mockResolvedValue(CARD_RESULT);
  const getApiKey = jest.fn().mockResolvedValue("sk-ant-xxxxxxxxxxxxxxxxxxxx");
  const { result } = renderHook(() => useMakeCard({ getApiKey }));

  await act(async () => {
    await result.current.run({ source_text: "Stormwater.", size: "square", tone: "punchy" });
  });

  expect(makeCard).toHaveBeenCalledWith(
    expect.objectContaining({
      source_text: "Stormwater.",
      size: "square",
      tone: "punchy",
      api_key: "sk-ant-xxxxxxxxxxxxxxxxxxxx",
      provider_id: "anthropic",
    }),
  );
  await waitFor(() => expect(result.current.status).toBe("done"));
  expect(result.current.result).toEqual(CARD_RESULT);
});

it("sends topic_version_id instead of source_text when given", async () => {
  makeCard.mockResolvedValue(CARD_RESULT);
  const getApiKey = jest.fn().mockResolvedValue("sk-ant-xxxxxxxxxxxxxxxxxxxx");
  const { result } = renderHook(() => useMakeCard({ getApiKey }));

  await act(async () => {
    await result.current.run({ topic_version_id: "tv-1", size: "story" });
  });

  const sent = makeCard.mock.calls[0][0];
  expect(sent.topic_version_id).toBe("tv-1");
  expect("source_text" in sent).toBe(false);
});

it("fails without calling makeCard when no key is saved and known not-Pro", async () => {
  (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: false }, loading: false });
  const getApiKey = jest.fn().mockResolvedValue(null);
  const { result } = renderHook(() => useMakeCard({ getApiKey }));
  await act(async () => {
    await result.current.run({ source_text: "x", size: "square" });
  });
  expect(makeCard).not.toHaveBeenCalled();
  await waitFor(() => expect(result.current.status).toBe("failed"));
  expect(result.current.error).toMatch(/api key/i);
});

describe("keyless-when-Pro wiring", () => {
  it("no saved key + Pro sends a keyless request (no api_key) and sets no error", async () => {
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: true }, loading: false });
    makeCard.mockResolvedValue(CARD_RESULT);
    const getApiKey = jest.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useMakeCard({ getApiKey }));

    await act(async () => {
      await result.current.run({ source_text: "Stormwater.", size: "square" });
    });

    expect(makeCard).toHaveBeenCalledTimes(1);
    const sent = makeCard.mock.calls[0][0];
    expect("api_key" in sent).toBe(false);
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.error).toBeNull();
  });

  it("no saved key + plan still loading (null) sends a keyless request (fail-open)", async () => {
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: null, loading: true });
    makeCard.mockResolvedValue(CARD_RESULT);
    const getApiKey = jest.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useMakeCard({ getApiKey }));

    await act(async () => {
      await result.current.run({ source_text: "Stormwater.", size: "square" });
    });

    expect(makeCard).toHaveBeenCalledTimes(1);
    expect("api_key" in makeCard.mock.calls[0][0]).toBe(false);
  });

  it("a saved key is always sent as BYOK, regardless of plan", async () => {
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: false }, loading: false });
    makeCard.mockResolvedValue(CARD_RESULT);
    const getApiKey = jest.fn().mockResolvedValue("sk-ant-xxxxxxxxxxxxxxxxxxxx");
    const { result } = renderHook(() => useMakeCard({ getApiKey }));

    await act(async () => {
      await result.current.run({ source_text: "Stormwater.", size: "square" });
    });

    expect(makeCard.mock.calls[0][0].api_key).toBe("sk-ant-xxxxxxxxxxxxxxxxxxxx");
  });
});

it("surfaces ApiError.userMessage on failure", async () => {
  makeCard.mockRejectedValue(new ApiError(502, JSON.stringify({ detail: "generated content failed validation" })));
  const getApiKey = jest.fn().mockResolvedValue("sk-ant-xxxxxxxxxxxxxxxxxxxx");
  const { result } = renderHook(() => useMakeCard({ getApiKey }));
  await act(async () => {
    await result.current.run({ source_text: "x", size: "square" });
  });
  await waitFor(() => expect(result.current.status).toBe("failed"));
  expect(result.current.error).toBe("generated content failed validation");
});
