import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ id: "b1" }),
}));

jest.mock("../../src/api/client", () => ({
  submitGenerate: jest.fn(),
  pollUntilDone: jest.fn(),
}));

jest.mock("../../src/secure/keyStore", () => ({ loadApiKey: jest.fn() }));

jest.mock("../../src/storage/bookStore", () => ({
  loadBook: jest.fn(),
  saveBook: jest.fn().mockResolvedValue(undefined),
  setTopicContent: (book: any, gen: any) => ({
    ...book,
    content: { ...(book.content ?? {}), [gen.topicId]: gen },
    updatedAt: "now",
  }),
  // The screen derives the already-done set from this; real impl filters by
  // renderable lesson. Tests here start with no content, so [] is correct.
  generatedTopicIds: (book: any) =>
    Object.entries(book?.content ?? {})
      .filter(([, g]: any) => (g?.lesson?.sections?.length ?? 0) > 0 || Boolean(g?.lesson?.synopsis?.trim()))
      .map(([id]) => id),
}));

jest.mock("../../src/components/LevelPicker", () => {
  const { View } = require("react-native");
  return { LevelPicker: () => <View testID="level-picker" /> };
});

const { submitGenerate, pollUntilDone } = require("../../src/api/client") as {
  submitGenerate: jest.Mock;
  pollUntilDone: jest.Mock;
};
const { loadApiKey } = require("../../src/secure/keyStore") as { loadApiKey: jest.Mock };
const { loadBook, saveBook } = require("../../src/storage/bookStore") as {
  loadBook: jest.Mock;
  saveBook: jest.Mock;
};

import GenerateAllScreen from "../../app/book/generate/[id]";

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

function book() {
  return {
    id: "b1",
    title: "Physics Primer",
    createdAt: "2026-05-26T10:00:00.000Z",
    updatedAt: "2026-05-26T10:00:00.000Z",
    toc: {
      subjects: [
        {
          subject_label: "Physics",
          units: [{ id: "t1", title: "Kinematics", subtopics: [], prerequisites: [] }],
        },
      ],
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  loadApiKey.mockResolvedValue("sk-ant-FAKE_KEY_test_12345");
  submitGenerate.mockResolvedValue({ job_id: "j1", status: "queued" });
});

describe("GenerateAllScreen", () => {
  it("loads the book and generates its topics, persisting each result", async () => {
    loadBook.mockResolvedValue(book());
    pollUntilDone.mockResolvedValue({ status: "done", result: LESSON });

    render(<GenerateAllScreen />);

    await waitFor(() => expect(screen.getByText("Physics Primer")).toBeTruthy());
    fireEvent.press(screen.getByLabelText("Generate all topics"));

    await waitFor(() => {
      expect(saveBook).toHaveBeenCalledWith(
        expect.objectContaining({
          // lesson.topic is forced to the clean topic title for the heading.
          content: expect.objectContaining({
            t1: expect.objectContaining({
              lesson: expect.objectContaining({ ...LESSON, topic: "Kinematics" }),
            }),
          }),
        }),
      );
    });
  });

  it("shows a not-found message when the book is missing", async () => {
    loadBook.mockResolvedValue(null);
    render(<GenerateAllScreen />);
    await waitFor(() => {
      expect(screen.getByText(/could not be found/)).toBeTruthy();
    });
  });
});
