/**
 * @jest-environment jsdom
 */
import React from "react";
import { Platform } from "react-native";
import { render } from "@testing-library/react-native";
import type { ImportedChapter } from "@/types/book";

jest.mock("react-native-webview", () => ({ default: () => null }));

// NativeChapterReader is web-only; stand it in with a marker so we can assert the
// web branch of ChapterRenderer resolves to it (and never to an iframe).
jest.mock("@/reader/NativeChapterReader", () => ({

  NativeChapterReader: () =>
    require("react").createElement("div", { className: "native-chapter-reader-stand-in" }),
}));

beforeAll(() => {
  Platform.OS = "web";
});
afterAll(() => {
  Platform.OS = "ios";
});


import { ChapterRenderer } from "@/components/LessonRenderer";

const chapter: ImportedChapter = {
  chapterId: "ch1",
  title: "Letter 1",
  html: "<p>hi</p>",
  images: {},
  importedAt: "2026-07-16T00:00:00.000Z",
};

type TestNode = { type: unknown; props: any };

it("on web, ChapterRenderer renders the native chapter reader and no iframe", () => {
  const { UNSAFE_root } = render(<ChapterRenderer chapter={chapter} />);
  const natives = UNSAFE_root.findAll(
    (n: TestNode) => n.type === ("div" as never) && n.props.className === "native-chapter-reader-stand-in",
  );
  const iframes = UNSAFE_root.findAll((n: TestNode) => n.type === ("iframe" as never));
  expect(natives).toHaveLength(1);
  expect(iframes).toHaveLength(0);
});
