/**
 * @jest-environment jsdom
 */
import React from "react";
import { Platform } from "react-native";
import { render } from "@testing-library/react-native";
import type { GeneratedTopic } from "@/types/book";

jest.mock("react-native-webview", () => ({ default: () => null }));

// A mutable flag read through a getter, rather than a fixed value baked into
// the mock at require-time. Babel's commonjs interop rewrites every use of a
// named import (`USE_NATIVE_WEB_READER` inside LessonRenderer.tsx) as a
// property read on the required module namespace, so this getter is
// re-evaluated on every render — letting a single test file flip the flag
// between cases without reloading the module graph (which would otherwise
// pull in a second, mismatched copy of "react": react-test-renderer's `render`
// and the component would then be calling hooks on two different React
// instances, crashing with "Invalid hook call").
// `mockFlagOn` must be named with a `mock` prefix — this repo's
// babel-plugin-jest-hoist forbids a jest.mock factory closing over an
// out-of-scope variable with any other name.
let mockFlagOn = false;
jest.mock("@/constants/readerFlag", () => ({
  get USE_NATIVE_WEB_READER() {
    return mockFlagOn;
  },
}));

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
  topicId: "t1", title: "T", generatedAt: "2026-07-10T00:00:00Z",
  lesson: {
    topic: "T", level: "adult", language: "en", synopsis: "S",
    learning_objectives: [], sections: [], key_takeaways: [], further_reading: [],
  },
};

// `react-test-renderer` ships no type declarations in this repo, so RNTL's
// `ReactTestInstance` degrades and `findAll`'s predicate parameter would be an
// implicit `any` (TS7006 under noImplicitAny). Annotate it explicitly.
 
type TestNode = { type: unknown; props: any };

function renderWithFlag(flagOn: boolean) {
  mockFlagOn = flagOn;
  const { UNSAFE_root } = render(<TopicRenderer topic={topic} />);
  return {
    iframes: UNSAFE_root.findAll((n: TestNode) => n.type === ("iframe" as never)),
    natives: UNSAFE_root.findAll(
      (n: TestNode) => n.type === ("div" as never) && n.props.className === "native-reader-stand-in",
    ),
  };
}

it("flag OFF → renders the iframe path (no user-visible change; spec D1)", () => {
  const { iframes, natives } = renderWithFlag(false);
  expect(iframes).toHaveLength(1);
  expect(natives).toHaveLength(0);
});

it("flag ON → renders the native reader, and no iframe is mounted", () => {
  const { iframes, natives } = renderWithFlag(true);
  expect(natives).toHaveLength(1);
  expect(iframes).toHaveLength(0);
});

it("the iframe path still carries its sandbox (regression guard)", () => {
  const { iframes } = renderWithFlag(false);
  expect(iframes[0]!.props.sandbox).toBe("allow-scripts");
  expect(String(iframes[0]!.props.sandbox)).not.toContain("allow-same-origin");
});
