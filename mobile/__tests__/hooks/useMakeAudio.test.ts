import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useMakeAudio } from "@/hooks/useMakeAudio";
import { ApiError } from "@/api/client";
import * as client from "@/api/derivativesClient";
import { useBillingPlan } from "@/hooks/useBillingPlan";

jest.mock("@/api/derivativesClient", () => ({ makeAudio: jest.fn() }));
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: jest.fn() }));
const makeAudio = client.makeAudio as jest.Mock;

const AUDIO_RESULT = {
  script: "Water finds the lowest point.",
  title: "Stormwater, decoded",
  audio_base64: "SUQzZmFrZQ==",
  mime: "audio/mpeg",
  provenance: "ai-generated",
};

beforeEach(() => {
  jest.clearAllMocks();
  (useBillingPlan as jest.Mock).mockReturnValue({ plan: null, loading: false });
});

it("sends the key, source text, tone and voice, then exposes the result on success", async () => {
  makeAudio.mockResolvedValue(AUDIO_RESULT);
  const getApiKey = jest.fn().mockResolvedValue("sk-xxxxxxxxxxxxxxxxxxxx");
  const { result } = renderHook(() => useMakeAudio({ getApiKey }));

  await act(async () => {
    await result.current.run({ source_text: "Stormwater.", tone: "warm", voice: "nova" });
  });

  expect(makeAudio).toHaveBeenCalledWith(
    expect.objectContaining({
      source_text: "Stormwater.",
      tone: "warm",
      voice: "nova",
      api_key: "sk-xxxxxxxxxxxxxxxxxxxx",
      provider_id: "openai",
    }),
  );
  await waitFor(() => expect(result.current.status).toBe("done"));
  expect(result.current.result).toEqual(AUDIO_RESULT);
});

it("sends topic_version_id instead of source_text when given", async () => {
  makeAudio.mockResolvedValue(AUDIO_RESULT);
  const getApiKey = jest.fn().mockResolvedValue("sk-xxxxxxxxxxxxxxxxxxxx");
  const { result } = renderHook(() => useMakeAudio({ getApiKey }));

  await act(async () => {
    await result.current.run({ topic_version_id: "tv-1" });
  });

  const sent = makeAudio.mock.calls[0][0];
  expect(sent.topic_version_id).toBe("tv-1");
  expect("source_text" in sent).toBe(false);
});

it("fails without calling makeAudio when no key is saved and known not-Pro", async () => {
  (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: false }, loading: false });
  const getApiKey = jest.fn().mockResolvedValue(null);
  const { result } = renderHook(() => useMakeAudio({ getApiKey }));
  await act(async () => {
    await result.current.run({ source_text: "x" });
  });
  expect(makeAudio).not.toHaveBeenCalled();
  await waitFor(() => expect(result.current.status).toBe("failed"));
  expect(result.current.error).toMatch(/openai/i);
});

describe("keyless-when-Pro wiring", () => {
  it("no saved key + Pro sends a keyless request (no api_key) and sets no error", async () => {
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: true }, loading: false });
    makeAudio.mockResolvedValue(AUDIO_RESULT);
    const getApiKey = jest.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useMakeAudio({ getApiKey }));

    await act(async () => {
      await result.current.run({ source_text: "Stormwater." });
    });

    expect(makeAudio).toHaveBeenCalledTimes(1);
    const sent = makeAudio.mock.calls[0][0];
    expect("api_key" in sent).toBe(false);
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.error).toBeNull();
  });

  it("no saved key + plan still loading (null) sends a keyless request (fail-open)", async () => {
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: null, loading: true });
    makeAudio.mockResolvedValue(AUDIO_RESULT);
    const getApiKey = jest.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useMakeAudio({ getApiKey }));

    await act(async () => {
      await result.current.run({ source_text: "Stormwater." });
    });

    expect(makeAudio).toHaveBeenCalledTimes(1);
    expect("api_key" in makeAudio.mock.calls[0][0]).toBe(false);
  });

  it("a saved key is always sent as BYOK, regardless of plan", async () => {
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: false }, loading: false });
    makeAudio.mockResolvedValue(AUDIO_RESULT);
    const getApiKey = jest.fn().mockResolvedValue("sk-xxxxxxxxxxxxxxxxxxxx");
    const { result } = renderHook(() => useMakeAudio({ getApiKey }));

    await act(async () => {
      await result.current.run({ source_text: "Stormwater." });
    });

    expect(makeAudio.mock.calls[0][0].api_key).toBe("sk-xxxxxxxxxxxxxxxxxxxx");
  });
});

it("surfaces ApiError.userMessage on failure", async () => {
  makeAudio.mockRejectedValue(
    new ApiError(422, JSON.stringify({ detail: "audio narration is not available for anthropic" })),
  );
  const getApiKey = jest.fn().mockResolvedValue("sk-xxxxxxxxxxxxxxxxxxxx");
  const { result } = renderHook(() => useMakeAudio({ getApiKey }));
  await act(async () => {
    await result.current.run({ source_text: "x" });
  });
  await waitFor(() => expect(result.current.status).toBe("failed"));
  expect(result.current.error).toBe("audio narration is not available for anthropic");
});
