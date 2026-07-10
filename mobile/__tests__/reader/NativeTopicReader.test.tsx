/**
 * @jest-environment jsdom
 */
import React from "react";
import { render } from "@testing-library/react-native";
// EXPLICIT `.web` path: jest-expo's haste defaultPlatform is "ios" and its platform
// list has no "web", so `@/reader/NativeTopicReader` resolves to the throwing native
// stub. Metro picks the `.web.tsx` on the real web bundle.
import { NativeTopicReader } from "@/reader/NativeTopicReader.web";
import type { GeneratedTopic } from "@/types/book";

// enhanceReaderNode touches a real HTMLElement; under RNTL the ref is null, so the
// effect no-ops. Mocked to assert the wiring; its behaviour is covered by enhance.test.ts.
//
// NOTE (deviation from the brief's literal code): babel-plugin-jest-hoist (as
// configured in this repo) forbids a jest.mock() factory from closing over an
// out-of-scope variable unless its name is prefixed "mock" (case-insensitive) —
// the brief's `enhanceReaderNode` name fails that check with "module factory
// … not allowed to reference any out-of-scope variables". Renamed to
// `mockEnhanceReaderNode` to satisfy the hoist rule; behaviour is unchanged.
const mockEnhanceReaderNode = jest.fn(() => jest.fn());
jest.mock("@/reader/enhance", () => ({
  enhanceReaderNode: (...a: unknown[]) => mockEnhanceReaderNode(...(a as [])),
}));

const topic = (body: string): GeneratedTopic => ({
  topicId: "t1",
  title: "T",
  generatedAt: "2026-07-10T00:00:00Z",
  lesson: {
    topic: "T", level: "adult", language: "en", synopsis: "S",
    learning_objectives: [], sections: [{ heading: "H", body_markdown: body }],
    key_takeaways: [], further_reading: [],
  },
});

// `react-test-renderer` ships no type declarations in this repo, so RNTL's
// `ReactTestInstance` degrades and `findAll`'s predicate parameter would be an
// implicit `any` (TS7006 under noImplicitAny). Annotate it explicitly. Props are
// untyped host-element props, so `any` is the honest type here.
 
type TestNode = { type: unknown; props: any };

const readerDiv = (root: ReturnType<typeof render>["UNSAFE_root"]) =>
  root.findAll(
    (n: TestNode) => n.type === ("div" as never) && n.props.className === "mentible-reader",
  )[0];

beforeEach(() => jest.clearAllMocks());

it("renders the topic content inline — no iframe anywhere in the tree", () => {
  const { UNSAFE_root } = render(<NativeTopicReader topic={topic("Hello **world**.")} />);
  expect(UNSAFE_root.findAll((n: TestNode) => n.type === ("iframe" as never))).toHaveLength(0);
  expect(readerDiv(UNSAFE_root)!.props.dangerouslySetInnerHTML.__html).toContain("<strong>world</strong>");
});

it("SECURITY: a hostile topic yields no executable markup in the injected html", () => {
  const { UNSAFE_root } = render(
    <NativeTopicReader topic={topic('<img src=x onerror="alert(1)"><script>alert(2)</script>')} />,
  );
  const html: string = readerDiv(UNSAFE_root)!.props.dangerouslySetInnerHTML.__html;
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/\son\w+\s*=/i);
  expect(html).not.toMatch(/javascript:/i);
});

// Under react-test-renderer `ref.current` is null, so the effect's guard short-circuits
// and enhanceReaderNode is never reached. This test pins the guard: without it the effect
// would throw on `node.querySelector` when mounted outside a browser. The pass itself is
// covered against a real DOM node in enhance.test.ts.
it("does not crash when mounted without a real DOM node, and leaves math as text", () => {
  const { UNSAFE_root } = render(<NativeTopicReader topic={topic("$$x^2$$")} />);
  expect(mockEnhanceReaderNode).not.toHaveBeenCalled();
  // The math survived sanitization as literal text, ready for the KaTeX pass on web.
  expect(readerDiv(UNSAFE_root)!.props.dangerouslySetInnerHTML.__html).toContain("$$x^2$$");
});

it("emits a scoped stylesheet — every rule sits under the reader root class", () => {
  const { UNSAFE_root } = render(<NativeTopicReader topic={topic("x")} />);
  const style = UNSAFE_root.findAll((n: TestNode) => n.type === ("style" as never))[0];
  const css: string = style!.props.children;
  // Extract each rule's selector: the text before "{" in every "…{…}" block. Do NOT
  // filter lines ending in "{" — most rules in readerStyles.ts are single-line, so
  // that would inspect only ~10 of the ~49 rules and silently under-test the invariant.
  const selectors = css
    .split("}")
    .map((block) => block.split("{")[0]!.trim())
    .filter(Boolean);
  expect(selectors.length).toBeGreaterThan(40); // 49 rules ported from the iframe
  for (const sel of selectors) expect(sel).toContain(".mentible-reader");
});
