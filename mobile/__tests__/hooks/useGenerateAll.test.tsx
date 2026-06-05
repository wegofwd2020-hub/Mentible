import { act, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("../../src/api/client", () => ({
  submitGenerate: jest.fn(),
  pollUntilDone: jest.fn(),
}));

const { submitGenerate, pollUntilDone } = require("../../src/api/client") as {
  submitGenerate: jest.Mock;
  pollUntilDone: jest.Mock;
};

import { useGenerateAll } from "../../src/hooks/useGenerateAll";
import type { StructuredTOC } from "../../src/types/book";
import type { GenerationParams } from "../../src/types/generationParams";

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

const params = (pages = 0): GenerationParams => ({
  level: "student",
  depth: "standard",
  pages,
  language: "en",
  format: "lesson",
});

function toc(): StructuredTOC {
  return {
    subjects: [
      {
        subject_label: "Physics",
        units: [
          { id: "t1", title: "Kinematics", subtopics: ["Speed"], prerequisites: [] },
          { id: "t2", title: "Dynamics", subtopics: [], prerequisites: [] },
        ],
      },
    ],
  };
}

const getApiKey = () => Promise.resolve("sk-ant-FAKE_KEY_test_12345");

beforeEach(() => {
  jest.clearAllMocks();
  submitGenerate.mockImplementation(() => Promise.resolve({ job_id: "j", status: "queued" }));
});

describe("useGenerateAll", () => {
  it("generates every topic in order and reports them done", async () => {
    pollUntilDone.mockResolvedValue({ status: "done", result: LESSON });
    const onTopicDone = jest.fn();

    const { result } = renderHook(() =>
      useGenerateAll({ toc: toc(), params: params(), getApiKey, onTopicDone, intervalMs: 1 }),
    );

    act(() => result.current.start());
    await waitFor(() => expect(result.current.finished).toBe(true));

    expect(result.current.doneCount).toBe(2);
    expect(result.current.failedCount).toBe(0);
    expect(submitGenerate).toHaveBeenCalledTimes(2);
    expect(onTopicDone).toHaveBeenCalledTimes(2);
    // The lesson heading is forced to the clean topic title (not the
    // subtopic-folded prompt the model may have echoed into lesson.topic).
    expect(onTopicDone).toHaveBeenCalledWith(
      "t1",
      "Kinematics",
      expect.objectContaining({ ...LESSON, topic: "Kinematics" }),
    );
  });

  it("passes the template's depth into each request", async () => {
    pollUntilDone.mockResolvedValue({ status: "done", result: LESSON });
    const { result } = renderHook(() =>
      useGenerateAll({
        toc: toc(),
        params: { ...params(), depth: "deep" },
        getApiKey,
        onTopicDone: jest.fn(),
        intervalMs: 1,
      }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.finished).toBe(true));
    expect(submitGenerate).toHaveBeenCalledWith(expect.objectContaining({ depth: "deep" }));
  });

  it("folds subtopics into the generated topic prompt", async () => {
    pollUntilDone.mockResolvedValue({ status: "done", result: LESSON });

    const { result } = renderHook(() =>
      useGenerateAll({ toc: toc(), params: params(), getApiKey, onTopicDone: jest.fn(), intervalMs: 1 }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.finished).toBe(true));

    expect(submitGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "Kinematics — covering: Speed" }),
    );
  });

  it("includes a topic's persisted enhancement instructions in its request", async () => {
    pollUntilDone.mockResolvedValue({ status: "done", result: LESSON });
    const tocWithInstr: StructuredTOC = {
      subjects: [
        {
          subject_label: "S",
          units: [
            {
              id: "t1",
              title: "Kinematics",
              subtopics: [],
              prerequisites: [],
              enhancementInstructions: "Add a diagram",
            },
          ],
        },
      ],
    };
    const { result } = renderHook(() =>
      useGenerateAll({ toc: tocWithInstr, params: params(), getApiKey, onTopicDone: jest.fn(), intervalMs: 1 }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.finished).toBe(true));
    expect(submitGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ instructions: "Add a diagram" }),
    );
  });

  it("continues past a failed topic and records the error", async () => {
    pollUntilDone
      .mockResolvedValueOnce({ status: "failed", error: "boom" })
      .mockResolvedValueOnce({ status: "done", result: LESSON });

    const { result } = renderHook(() =>
      useGenerateAll({ toc: toc(), params: params(), getApiKey, onTopicDone: jest.fn(), intervalMs: 1 }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.finished).toBe(true));

    expect(result.current.failedCount).toBe(1);
    expect(result.current.doneCount).toBe(1);
    const failed = result.current.progress.find((p) => p.topicId === "t1");
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBe("boom");
  });

  it("skips already-generated topics so a re-run only fills gaps", async () => {
    pollUntilDone.mockResolvedValue({ status: "done", result: LESSON });

    const { result } = renderHook(() =>
      useGenerateAll({
        toc: toc(),
        params: params(),
        getApiKey,
        onTopicDone: jest.fn(),
        alreadyDone: ["t1"],
        intervalMs: 1,
      }),
    );

    expect(result.current.progress.find((p) => p.topicId === "t1")?.status).toBe("done");

    act(() => result.current.start());
    await waitFor(() => expect(result.current.finished).toBe(true));

    expect(submitGenerate).toHaveBeenCalledTimes(1);
    expect(submitGenerate).toHaveBeenCalledWith(expect.objectContaining({ topic: "Dynamics" }));
    expect(result.current.doneCount).toBe(2);
  });

  it("regenerates every topic, overwriting done ones, when started with force", async () => {
    pollUntilDone.mockResolvedValue({ status: "done", result: LESSON });
    const onTopicDone = jest.fn();

    const { result } = renderHook(() =>
      useGenerateAll({
        toc: toc(),
        params: params(),
        getApiKey,
        onTopicDone,
        alreadyDone: ["t1"],
        intervalMs: 1,
      }),
    );

    act(() => result.current.start({ force: true }));
    await waitFor(() => expect(result.current.finished).toBe(true));

    expect(submitGenerate).toHaveBeenCalledTimes(2);
    expect(onTopicDone).toHaveBeenCalledWith(
      "t1",
      "Kinematics",
      expect.objectContaining({ topic: "Kinematics" }),
    );
    expect(result.current.doneCount).toBe(2);
  });

  it("splits the template's whole-book page target evenly across topics", async () => {
    pollUntilDone.mockResolvedValue({ status: "done", result: LESSON });

    const { result } = renderHook(() =>
      useGenerateAll({
        toc: toc(), // 2 topics
        params: params(10),
        getApiKey,
        onTopicDone: jest.fn(),
        intervalMs: 1,
      }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.finished).toBe(true));

    // 10 pages / 2 topics → 5 each.
    expect(submitGenerate).toHaveBeenCalledWith(expect.objectContaining({ target_pages: 5 }));
    expect(submitGenerate).toHaveBeenCalledTimes(2);
  });

  it("sends target_pages 0 (no target) when the template has no page target", async () => {
    pollUntilDone.mockResolvedValue({ status: "done", result: LESSON });

    const { result } = renderHook(() =>
      useGenerateAll({ toc: toc(), params: params(), getApiKey, onTopicDone: jest.fn(), intervalMs: 1 }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.finished).toBe(true));

    expect(submitGenerate).toHaveBeenCalledWith(expect.objectContaining({ target_pages: 0 }));
  });

  it("surfaces an error and does not generate when no API key is saved", async () => {
    const { result } = renderHook(() =>
      useGenerateAll({
        toc: toc(),
        params: params(),
        getApiKey: () => Promise.resolve(null),
        onTopicDone: jest.fn(),
        intervalMs: 1,
      }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.errorMsg).toMatch(/No API key/));

    expect(submitGenerate).not.toHaveBeenCalled();
    expect(result.current.running).toBe(false);
  });
});
