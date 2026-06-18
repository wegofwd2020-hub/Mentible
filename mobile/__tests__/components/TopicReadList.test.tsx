import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { TopicReadList } from "../../src/components/TopicReadList";
import type { Book, GeneratedTopic } from "../../src/types/book";

const GEN: GeneratedTopic = {
  topicId: "u1",
  title: "Kinematics",
  lesson: {
    title: "Kinematics",
    sections: [{ heading: "Intro", body_markdown: "body" }],
  } as unknown as GeneratedTopic["lesson"],
  generatedAt: "2026-05-27T00:00:00.000Z",
};

function makeBook(content: Book["content"]): Book {
  return {
    id: "b1",
    title: "Physics",
    toc: {
      subjects: [
        {
          subject_label: "Physics",
          units: [
            { id: "u1", title: "Kinematics", subtopics: [], prerequisites: [] },
            { id: "u2", title: "Dynamics", subtopics: [], prerequisites: [] },
          ],
        },
      ],
    },
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
    content,
  };
}

it("renders nothing when the book has no content", () => {
  const { toJSON } = render(<TopicReadList book={makeBook(undefined)} onOpen={() => {}} />);
  expect(toJSON()).toBeNull();
});

it("opens a topic that has content", () => {
  const onOpen = jest.fn();
  render(<TopicReadList book={makeBook({ u1: GEN })} onOpen={onOpen} />);
  fireEvent.press(screen.getByLabelText("Read topic: Kinematics"));
  expect(onOpen).toHaveBeenCalledWith("u1");
});

it("shows topics without content as not-yet-generated and non-tappable", () => {
  const onOpen = jest.fn();
  render(<TopicReadList book={makeBook({ u1: GEN })} onOpen={onOpen} />);
  // u2 has no content → labelled as not generated, pressing does nothing.
  const pending = screen.getByLabelText("Dynamics — not generated yet");
  fireEvent.press(pending);
  expect(onOpen).not.toHaveBeenCalled();
});
