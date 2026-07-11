/**
 * @jest-environment jsdom
 */
import React from "react";
import { Platform } from "react-native";
import { render } from "@testing-library/react-native";
import type { GeneratedTopic } from "@/types/book";

jest.mock("react-native-webview", () => ({ default: () => null }));

// NativeTopicReader is web-only; stand it in with a marker so we can assert the
// web branch of TopicRenderer resolves to it (and never to an iframe).
jest.mock("@/reader/NativeTopicReader", () => ({

  NativeTopicReader: () =>
    require("react").createElement("div", { className: "native-reader-stand-in" }),
}));

beforeAll(() => {
  Platform.OS = "web";
});
afterAll(() => {
  Platform.OS = "ios";
});


import { TopicRenderer } from "@/components/LessonRenderer";

const topic: GeneratedTopic = {
  topicId: "t1", title: "T", generatedAt: "2026-07-11T00:00:00Z",
  lesson: {
    topic: "T", level: "adult", language: "en", synopsis: "S",
    learning_objectives: [], sections: [], key_takeaways: [], further_reading: [],
  },
};


type TestNode = { type: unknown; props: any };

it("on web, TopicRenderer renders the native reader and no iframe", () => {
  const { UNSAFE_root } = render(<TopicRenderer topic={topic} />);
  const natives = UNSAFE_root.findAll(
    (n: TestNode) => n.type === ("div" as never) && n.props.className === "native-reader-stand-in",
  );
  const iframes = UNSAFE_root.findAll((n: TestNode) => n.type === ("iframe" as never));
  expect(natives).toHaveLength(1);
  expect(iframes).toHaveLength(0);
});
