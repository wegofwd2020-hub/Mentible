import { act, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("../../src/api/client", () => ({
  submitGenerate: jest.fn(),
  pollUntilDone: jest.fn(),
}));

jest.mock("../../src/hooks/useBillingPlan", () => ({ useBillingPlan: jest.fn() }));

const { submitGenerate, pollUntilDone } = require("../../src/api/client") as {
  submitGenerate: jest.Mock;
  pollUntilDone: jest.Mock;
};

import { useGenerateTopic } from "../../src/hooks/useGenerateTopic";
import { useBillingPlan } from "../../src/hooks/useBillingPlan";
import type { GenerationParams } from "../../src/types/generationParams";

const PARAMS: GenerationParams = {
  level: "student",
  depth: "standard",
  pages: 0,
  language: "en",
  format: "lesson",
  diagramRegister: "balanced",
  provider: "anthropic",
  model: null,
};

const LESSON = {
  topic: "x",
  level: "student",
  language: "en",
  synopsis: "s",
  learning_objectives: ["a"],
  sections: [{ heading: "h", body_markdown: "b" }],
  key_takeaways: ["k"],
  further_reading: [],
};

const getApiKey = () => Promise.resolve("sk-ant-FAKE_KEY_test_12345");

beforeEach(() => {
  jest.clearAllMocks();
  submitGenerate.mockImplementation(() => Promise.resolve({ job_id: "j", status: "queued" }));
  // Fail-open default (matches the other useBillingPlan consumers) — most
  // tests here don't care about Pro/Free, only the keyless-when-Pro suite
  // below overrides this per-case.
  (useBillingPlan as jest.Mock).mockReturnValue({ plan: null, loading: false });
});

describe("useGenerateTopic", () => {
  it("generates one topic and resolves with the lesson + provenance, folding subtopics", async () => {
    const prov = { provider: "anthropic", model: "claude-sonnet-4-6" };
    pollUntilDone.mockResolvedValue({ status: "done", result: LESSON, provenance: prov });

    const { result } = renderHook(() => useGenerateTopic({ getApiKey, intervalMs: 1 }));

    let out: unknown;
    await act(async () => {
      out = await result.current.run({
        title: "Kinematics",
        subtopics: ["Speed", "Velocity"],
        params: PARAMS,
      });
    });

    // Heading forced to the clean topic title (not the subtopic-folded prompt);
    // provenance from the job is surfaced for the caller to persist.
    expect(out).toEqual({ lesson: { ...LESSON, topic: "Kinematics" }, provenance: prov });
    expect(result.current.status).toBe("done");
    expect(submitGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "Kinematics — covering: Speed, Velocity" }),
    );
  });

  it("extracts provenance from the trust manifest (the post-SBQ-TRUST-001 wire shape)", async () => {
    // The backend now ships provenance inside the Content Trust Manifest
    // (ADR-015) rather than as a bare `provenance` field. The hook must surface
    // it so the badge still renders on a freshly generated topic.
    const prov = { provider: "anthropic", model: "claude-sonnet-4-6", model_verified: true };
    pollUntilDone.mockResolvedValue({
      status: "done",
      result: LESSON,
      trust: {
        trust_manifest_version: 1,
        provenance: { ...prov, generated_at: "2026-06-26T00:00:00Z" },
        validation: { schema_validated: true, repair_attempts: 0 },
      },
    });

    const { result } = renderHook(() => useGenerateTopic({ getApiKey, intervalMs: 1 }));
    let out: unknown;
    await act(async () => {
      out = await result.current.run({ title: "Kinematics", subtopics: [], params: PARAMS });
    });

    expect((out as { provenance?: unknown }).provenance).toEqual({
      ...prov,
      generated_at: "2026-06-26T00:00:00Z",
    });
  });

  it("passes enhancement instructions through to the request", async () => {
    pollUntilDone.mockResolvedValue({ status: "done", result: LESSON });

    const { result } = renderHook(() => useGenerateTopic({ getApiKey, intervalMs: 1 }));
    await act(async () => {
      await result.current.run({
        title: "Kinematics",
        subtopics: [],
        params: PARAMS,
        instructions: "Add a diagram",
      });
    });

    expect(submitGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ instructions: "Add a diagram" }),
    );
  });

  it("returns null and sets an error when generation fails", async () => {
    pollUntilDone.mockResolvedValue({ status: "failed", error: "boom" });

    const { result } = renderHook(() => useGenerateTopic({ getApiKey, intervalMs: 1 }));

    let lesson: unknown = "unset";
    await act(async () => {
      lesson = await result.current.run({ title: "Dynamics", subtopics: [], params: PARAMS });
    });

    expect(lesson).toBeNull();
    expect(result.current.status).toBe("failed");
    expect(result.current.error).toBe("boom");
  });

  it("returns null and reports a missing API key without calling the API when known not-Pro", async () => {
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: false }, loading: false });
    const { result } = renderHook(() =>
      useGenerateTopic({ getApiKey: () => Promise.resolve(null), intervalMs: 1 }),
    );

    let lesson: unknown = "unset";
    await act(async () => {
      lesson = await result.current.run({ title: "Dynamics", subtopics: [], params: PARAMS });
    });

    expect(lesson).toBeNull();
    expect(result.current.error).toMatch(/No API key/);
    expect(submitGenerate).not.toHaveBeenCalled();
  });

  // Keyless (managed) generation for Pro users with no saved BYOK key (mirrors
  // the trust hook's #433 fix). Decision: saved key => BYOK (unchanged); no key
  // + Pro => keyless (apiKey omitted, never ""); no key + not-Pro (incl.
  // plan: null, fail-open) => the existing "No API key saved" message.
  describe("keyless-when-Pro wiring", () => {
    it("no saved key + Pro sends a keyless request (no api_key) and sets no error", async () => {
      (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: true }, loading: false });
      pollUntilDone.mockResolvedValue({ status: "done", result: LESSON });

      const { result } = renderHook(() =>
        useGenerateTopic({ getApiKey: () => Promise.resolve(null), intervalMs: 1 }),
      );

      let lesson: unknown = "unset";
      await act(async () => {
        lesson = await result.current.run({ title: "Dynamics", subtopics: [], params: PARAMS });
      });

      expect(result.current.error).toBeNull();
      expect(lesson).not.toBeNull();
      expect(submitGenerate).toHaveBeenCalledTimes(1);
      const sent = submitGenerate.mock.calls[0][0];
      expect(sent.api_key).toBeUndefined();
      expect("api_key" in sent).toBe(false);
    });

    it("no saved key + plan still loading (null) sends a keyless request (fail-open)", async () => {
      (useBillingPlan as jest.Mock).mockReturnValue({ plan: null, loading: true });
      pollUntilDone.mockResolvedValue({ status: "done", result: LESSON });

      const { result } = renderHook(() =>
        useGenerateTopic({ getApiKey: () => Promise.resolve(null), intervalMs: 1 }),
      );

      await act(async () => {
        await result.current.run({ title: "Dynamics", subtopics: [], params: PARAMS });
      });

      expect(result.current.error).toBeNull();
      expect(submitGenerate).toHaveBeenCalledTimes(1);
      expect(submitGenerate.mock.calls[0][0].api_key).toBeUndefined();
    });

    it("a saved key is always sent as BYOK, regardless of plan", async () => {
      (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: false }, loading: false });
      pollUntilDone.mockResolvedValue({ status: "done", result: LESSON });

      const { result } = renderHook(() =>
        useGenerateTopic({ getApiKey, intervalMs: 1 }),
      );

      await act(async () => {
        await result.current.run({ title: "Dynamics", subtopics: [], params: PARAMS });
      });

      expect(submitGenerate.mock.calls[0][0].api_key).toBe("sk-ant-FAKE_KEY_test_12345");
    });
  });
});
