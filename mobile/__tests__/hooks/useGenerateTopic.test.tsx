import { act, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("../../src/api/client", () => ({
  submitGenerate: jest.fn(),
  pollUntilDone: jest.fn(),
}));

const { submitGenerate, pollUntilDone } = require("../../src/api/client") as {
  submitGenerate: jest.Mock;
  pollUntilDone: jest.Mock;
};

import { useGenerateTopic } from "../../src/hooks/useGenerateTopic";
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

  it("returns null and reports a missing API key without calling the API", async () => {
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
});
