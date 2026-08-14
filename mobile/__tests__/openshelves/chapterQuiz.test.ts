// Open Shelves F2 Task 2: generate + store a source-grounded chapter quiz.
//
// Two units under test:
//   1. chapterPlainText — HTML -> plaintext extraction + cap, feeding source_text.
//   2. useGenerateChapterQuiz — submit -> poll -> persist at
//      book.chapterQuizzes[chapterId], WITHOUT ever touching
//      book.chapters[chapterId].html (the F1 read-only invariant).
import { act, renderHook } from "@testing-library/react-native";

jest.mock("@/api/client", () => ({
  submitGenerate: jest.fn(),
  pollUntilDone: jest.fn(),
  ApiError: jest.requireActual("@/api/client").ApiError,
}));
jest.mock("@/storage/bookStore", () => ({
  loadBook: jest.fn(),
  saveBook: jest.fn(),
}));
jest.mock("@/secure/keyStore", () => ({
  loadApiKey: jest.fn(),
}));
jest.mock("@/storage/usageStore", () => ({
  recordUsage: jest.fn(),
}));
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: jest.fn() }));
// A mutable mock (not the real, build-time-inlined IS_DEMO — see
// __tests__/constants/demo.test.ts) so the "demo build blocks" case below can
// flip it at runtime without jest.resetModules() (which duplicates React and
// breaks renderHook's internal state).
jest.mock("@/constants/demo", () => ({ IS_DEMO: false }));

const { submitGenerate, pollUntilDone } = require("@/api/client") as {
  submitGenerate: jest.Mock;
  pollUntilDone: jest.Mock;
};
const { loadBook, saveBook } = require("@/storage/bookStore") as {
  loadBook: jest.Mock;
  saveBook: jest.Mock;
};
const { loadApiKey } = require("@/secure/keyStore") as { loadApiKey: jest.Mock };
const { recordUsage } = require("@/storage/usageStore") as { recordUsage: jest.Mock };
const demoModule = require("@/constants/demo") as { IS_DEMO: boolean };

import { chapterPlainText, MAX_QUIZ_SOURCE } from "@/openshelves/chapterText";
import { useGenerateChapterQuiz } from "@/hooks/useGenerateChapterQuiz";
import { useBillingPlan } from "@/hooks/useBillingPlan";
import type { Book, ImportedChapter, QuizSet } from "@/types/book";

function chapter(over: Partial<ImportedChapter> = {}): ImportedChapter {
  return {
    chapterId: "c1",
    title: "Chapter One",
    html: "<p>Hello <b>world</b>.</p>",
    images: {},
    importedAt: "2026-07-19T00:00:00.000Z",
    ...over,
  };
}

function book(over: Partial<Book> = {}): Book {
  return {
    id: "bk-1",
    title: "A Book",
    toc: { subjects: [] },
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
    source: "imported",
    chapters: { c1: chapter() },
    ...over,
  };
}

const QUIZ: QuizSet = {
  set_number: 1,
  questions: [
    {
      question_id: "q1",
      question_text: "What happened?",
      question_type: "multiple_choice",
      options: [
        { option_id: "A", text: "Nothing" },
        { option_id: "B", text: "Something" },
      ],
      correct_option: "B",
      explanation: "The passage says so.",
      difficulty: "easy",
    },
  ],
  total_questions: 1,
  passing_score: 1,
  estimated_duration_minutes: 2,
};

describe("chapterPlainText", () => {
  it("strips tags and decodes entities", () => {
    const { text, truncated } = chapterPlainText(chapter({ html: "<p>Hello &amp; <b>world</b>.</p>" }));
    expect(text).toBe("Hello & world .");
    expect(truncated).toBe(false);
  });

  it("collapses whitespace left behind by stripped tags", () => {
    const { text } = chapterPlainText(chapter({ html: "<p>One</p>\n\n<p>Two</p>" }));
    expect(text).toBe("One Two");
  });

  it("caps at MAX_QUIZ_SOURCE and reports truncated", () => {
    const long = "word ".repeat(5000); // far over 12000 chars
    const { text, truncated } = chapterPlainText(chapter({ html: `<p>${long}</p>` }));
    expect(text.length).toBe(MAX_QUIZ_SOURCE);
    expect(truncated).toBe(true);
  });

  it("does not truncate text at or under the cap", () => {
    const exact = "a".repeat(MAX_QUIZ_SOURCE);
    const { text, truncated } = chapterPlainText(chapter({ html: exact }));
    expect(text.length).toBe(MAX_QUIZ_SOURCE);
    expect(truncated).toBe(false);
  });
});

describe("useGenerateChapterQuiz", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadApiKey.mockResolvedValue("sk-ant-FAKE_KEY_test_12345");
    submitGenerate.mockResolvedValue({ job_id: "j1", status: "queued" });
    // Fail-open default (matches the other useBillingPlan consumers) — most
    // tests here don't care about Pro/Free, only the keyless-when-Pro suite
    // below overrides this per-case.
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: null, loading: false });
  });

  it("submits format:quiz with the chapter's plaintext as source_text", async () => {
    const b = book();
    loadBook.mockResolvedValue(b);
    pollUntilDone.mockResolvedValue({ status: "done", result: QUIZ });

    const { result } = renderHook(() => useGenerateChapterQuiz());

    await act(async () => {
      await result.current.generate("bk-1", "c1");
    });

    expect(submitGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "quiz",
        source_text: chapterPlainText(chapter()).text,
        topic: "Chapter One",
      }),
    );
  });

  it("stores the QuizSet at book.chapterQuizzes[chapterId] and leaves chapter.html byte-unchanged", async () => {
    const b = book();
    const originalHtml = b.chapters!.c1.html;
    loadBook.mockResolvedValue(b);
    pollUntilDone.mockResolvedValue({ status: "done", result: QUIZ });

    const { result } = renderHook(() => useGenerateChapterQuiz());

    let out: QuizSet | null = null;
    await act(async () => {
      out = await result.current.generate("bk-1", "c1");
    });

    expect(out).toEqual(QUIZ);
    expect(result.current.status).toBe("done");
    expect(saveBook).toHaveBeenCalledTimes(1);
    const saved = saveBook.mock.calls[0][0] as Book;
    expect(saved.chapterQuizzes).toEqual({ c1: QUIZ });
    // The read-only invariant (F1): the chapter body itself must never move.
    expect(saved.chapters!.c1.html).toBe(originalHtml);
  });

  it("records observed token usage on success, attributed to the chapter title", async () => {
    const b = book();
    loadBook.mockResolvedValue(b);
    const usage = {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      input_tokens: 1200,
      output_tokens: 300,
      tokens_estimated: false,
      attempts: 1,
    };
    pollUntilDone.mockResolvedValue({ status: "done", result: QUIZ, usage });

    const { result } = renderHook(() => useGenerateChapterQuiz());
    await act(async () => {
      await result.current.generate("bk-1", "c1");
    });

    expect(recordUsage).toHaveBeenCalledWith(usage, { topicTitle: "Chapter One" });
  });

  it("does not record usage when the job reports none", async () => {
    loadBook.mockResolvedValue(book());
    pollUntilDone.mockResolvedValue({ status: "done", result: QUIZ });

    const { result } = renderHook(() => useGenerateChapterQuiz());
    await act(async () => {
      await result.current.generate("bk-1", "c1");
    });

    expect(recordUsage).not.toHaveBeenCalled();
  });

  it("sets truncated when the chapter had to be cut", async () => {
    const long = "word ".repeat(5000);
    const b = book({ chapters: { c1: chapter({ html: `<p>${long}</p>` }) } });
    loadBook.mockResolvedValue(b);
    pollUntilDone.mockResolvedValue({ status: "done", result: QUIZ });

    const { result } = renderHook(() => useGenerateChapterQuiz());
    await act(async () => {
      await result.current.generate("bk-1", "c1");
    });

    expect(result.current.truncated).toBe(true);
  });

  it("sets status failed and an error when generation fails", async () => {
    loadBook.mockResolvedValue(book());
    pollUntilDone.mockResolvedValue({ status: "failed", error: "boom" });

    const { result } = renderHook(() => useGenerateChapterQuiz());
    let out: QuizSet | null = null;
    await act(async () => {
      out = await result.current.generate("bk-1", "c1");
    });

    expect(out).toBeNull();
    expect(result.current.status).toBe("failed");
    expect(result.current.error).toBe("boom");
    expect(saveBook).not.toHaveBeenCalled();
  });

  // Keyless (managed) generation for Pro users with no saved BYOK key (mirrors
  // the trust hook's #433 fix). Decision: saved key => BYOK (unchanged); no key
  // + Pro => keyless (api_key omitted, never ""); no key + not-Pro (incl.
  // plan: null, fail-open) => the existing "No API key saved" message.
  describe("keyless-when-Pro wiring", () => {
    it("no saved key + Pro sends a keyless request (no api_key) and sets no error", async () => {
      loadApiKey.mockResolvedValue(null);
      (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: true }, loading: false });
      loadBook.mockResolvedValue(book());
      pollUntilDone.mockResolvedValue({ status: "done", result: QUIZ });

      const { result } = renderHook(() => useGenerateChapterQuiz());
      let out: QuizSet | null = null;
      await act(async () => {
        out = await result.current.generate("bk-1", "c1");
      });

      expect(out).toEqual(QUIZ);
      expect(result.current.status).toBe("done");
      expect(result.current.error).toBeNull();
      expect(submitGenerate).toHaveBeenCalledTimes(1);
      const sent = submitGenerate.mock.calls[0][0];
      expect("api_key" in sent).toBe(false);
    });

    it("no saved key + not-Pro sets the add-a-key error without calling submitGenerate", async () => {
      loadApiKey.mockResolvedValue(null);
      (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: false }, loading: false });
      loadBook.mockResolvedValue(book());

      const { result } = renderHook(() => useGenerateChapterQuiz());
      let out: QuizSet | null = null;
      await act(async () => {
        out = await result.current.generate("bk-1", "c1");
      });

      expect(out).toBeNull();
      expect(result.current.status).toBe("failed");
      expect(result.current.error).toMatch(/No API key/);
      expect(submitGenerate).not.toHaveBeenCalled();
    });

    it("no saved key + plan still loading (null) sends a keyless request (fail-open)", async () => {
      loadApiKey.mockResolvedValue(null);
      (useBillingPlan as jest.Mock).mockReturnValue({ plan: null, loading: true });
      loadBook.mockResolvedValue(book());
      pollUntilDone.mockResolvedValue({ status: "done", result: QUIZ });

      const { result } = renderHook(() => useGenerateChapterQuiz());
      await act(async () => {
        await result.current.generate("bk-1", "c1");
      });

      expect(result.current.error).toBeNull();
      expect(submitGenerate).toHaveBeenCalledTimes(1);
      expect("api_key" in submitGenerate.mock.calls[0][0]).toBe(false);
    });

    it("a saved key is always sent as BYOK, regardless of plan", async () => {
      loadApiKey.mockResolvedValue("sk-ant-FAKE_KEY_test_12345");
      (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: false }, loading: false });
      loadBook.mockResolvedValue(book());
      pollUntilDone.mockResolvedValue({ status: "done", result: QUIZ });

      const { result } = renderHook(() => useGenerateChapterQuiz());
      await act(async () => {
        await result.current.generate("bk-1", "c1");
      });

      expect(submitGenerate.mock.calls[0][0].api_key).toBe("sk-ant-FAKE_KEY_test_12345");
    });
  });

  it("blocks in a demo build without calling submitGenerate", async () => {
    demoModule.IS_DEMO = true;
    try {
      const { result } = renderHook(() => useGenerateChapterQuiz());

      await expect(
        act(async () => {
          await result.current.generate("bk-1", "c1");
        }),
      ).rejects.toThrow(/demo build/);

      expect(submitGenerate).not.toHaveBeenCalled();
      expect(loadBook).not.toHaveBeenCalled();
    } finally {
      demoModule.IS_DEMO = false;
    }
  });
});
