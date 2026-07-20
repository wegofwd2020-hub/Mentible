// Open Shelves F2 Task 3: the "Make a quiz from this chapter" trigger on the
// F1 read-only chapter screen, and rendering the resulting QuizSet in the
// reader. The quiz is model markdown → it goes through the SAME sanitize +
// KaTeX render path a topic uses (QuizRenderer/buildChapterQuizHtml), never
// the chapter's raw-HTML path (which deliberately skips KaTeX/enhance — see
// NativeChapterReader.web.tsx).
import React from "react";
import { Platform } from "react-native";
import { render, screen, waitFor, fireEvent } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ bookId: "bk-1", chapterId: "c1" }),
  Stack: { Screen: () => null },
}));
jest.mock("@/components/PageContainer", () => ({
  PageContainer: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/storage/bookStore", () => ({ loadBook: jest.fn() }));

// Stub ONLY ChapterRenderer (its correctness is covered by its own tests —
// e.g. ChapterRenderer.switch.test.tsx). QuizRenderer stays the REAL
// implementation: this test's whole point is proving a stored/generated
// QuizSet reaches the actual quiz render + sanitize path, not a hand-rolled one.
jest.mock("@/components/LessonRenderer", () => {
  const actual = jest.requireActual("@/components/LessonRenderer");
  return {
    ...actual,
    ChapterRenderer: ({ chapter }: { chapter: { title: string } }) => {
      const { Text } = require("react-native");
      return <Text accessibilityLabel="Chapter content">{chapter.title}</Text>;
    },
  };
});

// Stub the WebView so its `source.html` prop (the built document) is
// inspectable — jest can't execute the in-page script, but the embedded
// question text is enough to prove the quiz reached the renderer (mirrors
// __tests__/components/contentHtml.test.ts's embeddedHtml approach).
jest.mock("react-native-webview", () => ({
  default: ({ source, accessibilityLabel }: { source?: { html?: string }; accessibilityLabel?: string }) => {
    const { Text } = require("react-native");
    return <Text accessibilityLabel={accessibilityLabel}>{source?.html ?? ""}</Text>;
  },
}));

// jest.mock() factories are hoisted above ALL other module code (including
// plain `const` declarations that precede them in source) — closing over an
// outer, non-"mock"-prefixed variable here is a documented Jest footgun.
// Standard escape hatch (same pattern __tests__/openshelves/chapterQuiz.test.ts
// uses for @/api/client): the factory returns a bare jest.fn(), and the test
// body pulls it back out via require() to configure per-test.
jest.mock("@/hooks/useGenerateChapterQuiz", () => ({
  useGenerateChapterQuiz: jest.fn(),
}));

// Mutable IS_DEMO mock (same pattern as chapterQuiz.test.ts) so the demo case
// can flip it without jest.resetModules().
jest.mock("@/constants/demo", () => ({ IS_DEMO: false }));

// Discovery nudge (F3 Task 4): mock useNudge to control visibility without
// touching AsyncStorage (mutable module-level flag, same footgun/escape-hatch
// pattern as the other jest.mock()s above).
jest.mock("@/discovery/useNudge", () => ({
  useNudge: () => ({ visible: mockNudgeVisible, dismiss: jest.fn() }),
}));
let mockNudgeVisible = true;

import { loadBook } from "@/storage/bookStore";
import ReadChapterScreen from "@/../app/book/chapter/[bookId]/[chapterId]";
import type { Book, QuizSet } from "@/types/book";
const { useGenerateChapterQuiz } = require("@/hooks/useGenerateChapterQuiz") as {
  useGenerateChapterQuiz: jest.Mock;
};
const demoModule = require("@/constants/demo") as { IS_DEMO: boolean };

const generateMock = jest.fn();
const hookState: {
  status: "idle" | "generating" | "done" | "failed";
  error: string | null;
  truncated: boolean;
  generate: jest.Mock;
} = { status: "idle", error: null, truncated: false, generate: generateMock };

function book(over: Partial<Book> = {}): Book {
  return {
    id: "bk-1",
    title: "A Book",
    toc: { subjects: [] },
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
    source: "imported",
    chapters: {
      c1: {
        chapterId: "c1",
        title: "Chapter One",
        html: "<p>Once upon a time.</p>",
        images: {},
        importedAt: "2026-07-19T00:00:00.000Z",
      },
    },
    ...over,
  };
}

const QUIZ: QuizSet = {
  set_number: 1,
  questions: [
    {
      question_id: "q1",
      question_text: "What happened first in the chapter?",
      question_type: "multiple_choice",
      options: [
        { option_id: "A", text: "Nothing" },
        { option_id: "B", text: "Something distinctive" },
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

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = "ios";
  hookState.status = "idle";
  hookState.error = null;
  hookState.truncated = false;
  hookState.generate = generateMock;
  useGenerateChapterQuiz.mockReturnValue(hookState);
  mockNudgeVisible = true;
});

afterEach(() => {
  demoModule.IS_DEMO = false;
});

it("shows the make-a-quiz control on native, non-demo, before any quiz exists", async () => {
  (loadBook as jest.Mock).mockResolvedValue(book());
  render(<ReadChapterScreen />);
  await waitFor(() => expect(screen.getByLabelText("Make a quiz from this chapter")).toBeTruthy());
});

it("shows the make-a-quiz control on WEB too (cross-platform trigger — web is where reveal is wired)", async () => {
  Platform.OS = "web";
  (loadBook as jest.Mock).mockResolvedValue(book());
  render(<ReadChapterScreen />);
  await waitFor(() => expect(screen.getByLabelText("Make a quiz from this chapter")).toBeTruthy());
});

it("pressing the control invokes useGenerateChapterQuiz.generate with the book and chapter id", async () => {
  (loadBook as jest.Mock).mockResolvedValue(book());
  generateMock.mockResolvedValue(QUIZ);
  render(<ReadChapterScreen />);

  const btn = await screen.findByLabelText("Make a quiz from this chapter");
  fireEvent.press(btn);

  await waitFor(() => expect(generateMock).toHaveBeenCalledWith("bk-1", "c1"));
});

it("renders the quiz (a question's text appears) once generation succeeds", async () => {
  (loadBook as jest.Mock).mockResolvedValue(book());
  generateMock.mockResolvedValue(QUIZ);
  render(<ReadChapterScreen />);

  const btn = await screen.findByLabelText("Make a quiz from this chapter");
  fireEvent.press(btn);

  await waitFor(() => {
    const quizView = screen.getByLabelText("Chapter quiz");
    expect(quizView.props.children).toContain("What happened first in the chapter?");
  });
});

it("renders a quiz already stored on the book without pressing anything", async () => {
  (loadBook as jest.Mock).mockResolvedValue(book({ chapterQuizzes: { c1: QUIZ } }));
  render(<ReadChapterScreen />);

  await waitFor(() => {
    const quizView = screen.getByLabelText("Chapter quiz");
    expect(quizView.props.children).toContain("What happened first in the chapter?");
  });
});

it("shows a generating state and disables re-triggering while in flight", async () => {
  (loadBook as jest.Mock).mockResolvedValue(book());
  hookState.status = "generating";
  render(<ReadChapterScreen />);

  await waitFor(() => expect(screen.getByText(/Generating quiz/i)).toBeTruthy());
  expect(screen.queryByLabelText("Make a quiz from this chapter")).toBeNull();
});

it("shows the truncation hint when the hook reports the chapter was capped", async () => {
  (loadBook as jest.Mock).mockResolvedValue(book());
  hookState.truncated = true;
  render(<ReadChapterScreen />);

  await waitFor(() => expect(screen.getByText(/first part/i)).toBeTruthy());
});

it("shows an error surface when the hook reports one", async () => {
  (loadBook as jest.Mock).mockResolvedValue(book());
  hookState.error = "Generation failed";
  render(<ReadChapterScreen />);

  await waitFor(() => expect(screen.getByText("Generation failed")).toBeTruthy());
});

it("shows the chapter-quiz nudge when the quiz trigger is available", async () => {
  mockNudgeVisible = true;
  (loadBook as jest.Mock).mockResolvedValue(book());
  render(<ReadChapterScreen />);
  expect(await screen.findByTestId("nudge-chapter-quiz")).toBeTruthy();
});

it("hides the nudge once dismissed", async () => {
  mockNudgeVisible = false;
  (loadBook as jest.Mock).mockResolvedValue(book());
  render(<ReadChapterScreen />);
  await waitFor(() => expect(screen.getByLabelText("Make a quiz from this chapter")).toBeTruthy());
  expect(screen.queryByTestId("nudge-chapter-quiz")).toBeNull();
});

it("hides the control in a demo build", async () => {
  demoModule.IS_DEMO = true;
  (loadBook as jest.Mock).mockResolvedValue(book());
  const { queryByTestId } = render(<ReadChapterScreen />);

  await waitFor(() => expect(screen.getByLabelText("Chapter content")).toBeTruthy());
  expect(screen.queryByLabelText("Make a quiz from this chapter")).toBeNull();
  expect(queryByTestId("nudge-chapter-quiz")).toBeNull();
});


afterAll(() => {
  Platform.OS = "ios";
});
