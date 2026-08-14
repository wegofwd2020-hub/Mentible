import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useMakePost } from "@/hooks/useMakePost";
import { ApiError } from "@/api/client";
import * as client from "@/api/derivativesClient";
import { useBillingPlan } from "@/hooks/useBillingPlan";

jest.mock("@/api/derivativesClient", () => ({ makePost: jest.fn() }));
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: jest.fn() }));
const makePost = client.makePost as jest.Mock;

const VARIANTS = [
  { hook: "h0", body: "b0", hashtags: ["#a"], cta: null },
  { hook: "h1", body: "b1", hashtags: ["#a"], cta: null },
  { hook: "h2", body: "b2", hashtags: ["#a"], cta: null },
];

beforeEach(() => {
  jest.clearAllMocks();
  // Fail-open default (matches the other useBillingPlan consumers) — most
  // tests here don't care about Pro/Free, only the keyless-when-Pro suite
  // below overrides this per-case.
  (useBillingPlan as jest.Mock).mockReturnValue({ plan: null, loading: false });
});

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

it("fails without calling makePost when no key is saved and known not-Pro", async () => {
  (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: false }, loading: false });
  const getApiKey = jest.fn().mockResolvedValue(null);
  const { result } = renderHook(() => useMakePost({ getApiKey }));
  await act(async () => {
    await result.current.run({ sourceText: "x", platform: "x" });
  });
  expect(makePost).not.toHaveBeenCalled();
  await waitFor(() => expect(result.current.status).toBe("failed"));
  expect(result.current.error).toMatch(/api key/i);
});

// Keyless (managed) generation for Pro users with no saved BYOK key (mirrors
// the trust hook's #433 fix).
describe("keyless-when-Pro wiring", () => {
  it("no saved key + Pro sends a keyless request (no api_key) and sets no error", async () => {
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: true }, loading: false });
    makePost.mockResolvedValue({ platform: "linkedin", variants: VARIANTS, provenance: "ai-generated" });
    const getApiKey = jest.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useMakePost({ getApiKey }));

    await act(async () => {
      await result.current.run({ sourceText: "Stormwater.", platform: "linkedin" });
    });

    expect(makePost).toHaveBeenCalledTimes(1);
    const sent = makePost.mock.calls[0][0];
    expect("api_key" in sent).toBe(false);
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.error).toBeNull();
  });

  it("no saved key + plan still loading (null) sends a keyless request (fail-open)", async () => {
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: null, loading: true });
    makePost.mockResolvedValue({ platform: "linkedin", variants: VARIANTS, provenance: "ai-generated" });
    const getApiKey = jest.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useMakePost({ getApiKey }));

    await act(async () => {
      await result.current.run({ sourceText: "Stormwater.", platform: "linkedin" });
    });

    expect(makePost).toHaveBeenCalledTimes(1);
    expect("api_key" in makePost.mock.calls[0][0]).toBe(false);
  });

  it("a saved key is always sent as BYOK, regardless of plan", async () => {
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: false }, loading: false });
    makePost.mockResolvedValue({ platform: "linkedin", variants: VARIANTS, provenance: "ai-generated" });
    const getApiKey = jest.fn().mockResolvedValue("sk-ant-xxxxxxxxxxxxxxxxxxxx");
    const { result } = renderHook(() => useMakePost({ getApiKey }));

    await act(async () => {
      await result.current.run({ sourceText: "Stormwater.", platform: "linkedin" });
    });

    expect(makePost.mock.calls[0][0].api_key).toBe("sk-ant-xxxxxxxxxxxxxxxxxxxx");
  });
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

it("forwards the image when provided", async () => {
  makePost.mockResolvedValue({ platform: "linkedin", variants: VARIANTS, provenance: "ai-generated" });
  const getApiKey = jest.fn().mockResolvedValue("sk-ant-xxxxxxxxxxxxxxxxxxxx");
  const { result } = renderHook(() => useMakePost({ getApiKey }));

  await act(async () => {
    await result.current.run({
      sourceText: "Stormwater.",
      platform: "linkedin",
      image: { media_type: "image/png", data: "AAA" },
    });
  });

  expect(makePost).toHaveBeenCalledWith(
    expect.objectContaining({
      source_text: "Stormwater.",
      platform: "linkedin",
      image: { media_type: "image/png", data: "AAA" },
      api_key: "sk-ant-xxxxxxxxxxxxxxxxxxxx",
      provider_id: "anthropic",
    }),
  );
  await waitFor(() => expect(result.current.status).toBe("done"));
  expect(result.current.variants).toHaveLength(3);
});
