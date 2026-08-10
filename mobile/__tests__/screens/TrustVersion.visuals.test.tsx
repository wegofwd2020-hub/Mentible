/**
 * @jest-environment jsdom
 */
import React from "react";
import { Platform } from "react-native";
import { render, screen, waitFor, fireEvent } from "@testing-library/react-native";

// Whole-book draft viewer (T3): on web, view mode must render section bodies
// through the reader's real pipeline (TopicRenderer -> NativeTopicReader),
// so ```svg / ```mermaid fences in a draft actually draw as diagrams instead
// of showing as raw fence text. Native stays plain-text — that's covered by
// TrustVersion.read.test.tsx, which runs on the jest-expo default platform
// ("ios") and is unaffected by this change.

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ versionId: "v1", artifactId: "a1", projectId: "p1" }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({
    project: { my_role: "owner", inputs: [{ id: "src1" }, { id: "src2" }] },
    addVersion: jest.fn(),
    generateVersion: jest.fn(),
    approve: jest.fn(),
    unapprove: jest.fn(),
  }),
}));

// LessonRenderer.tsx's module-level `Platform.OS !== "web"` require gate runs
// at import time, before this file's beforeAll sets Platform.OS to "web" — so
// it still requires the native react-native-webview module (unused once the
// component actually renders on "web"). Stub it out; TopicRenderer.switch.test.tsx
// does the same for the same reason.
jest.mock("react-native-webview", () => ({ default: () => null }));

const SVG_BODY = '```svg\n<svg><rect width="10" height="10"/></svg>\n```';
const MERMAID_BODY = "```mermaid\ngraph TD; A-->B;\n```";

jest.mock("@/api/trustClient", () => ({
  getVersion: jest.fn(async () => ({
    id: "v1",
    artifact_id: "a1",
    version_no: 2,
    content: {
      sections: [
        { heading: "Diagram", body: SVG_BODY, source_ids: ["src1"] },
        { heading: "Flow", body: MERMAID_BODY, source_ids: ["src2"] },
      ],
    },
    generation_meta: null,
    is_validated: false,
    recorded_via: null,
    created_at: null,
    feedback: [],
  })),
  addFeedback: jest.fn(),
}));

// jest-expo's Haste platform resolution has no "web" entry (defaultPlatform
// "ios"), so a bare `@/reader/NativeTopicReader` import always resolves to
// the throwing native stub, regardless of Platform.OS at render time (see
// __tests__/reader/NativeTopicReader.test.tsx's note). Swap in the real
// `.web` implementation so TopicRenderer's web branch renders for real,
// through the same sanitize+markdown pipeline the app uses.
jest.mock("@/reader/NativeTopicReader", () => require("@/reader/NativeTopicReader.web"));

beforeAll(() => {
  Platform.OS = "web";
});
afterAll(() => {
  Platform.OS = "ios";
});

import TrustVersion from "@/../app/trust/version/[versionId]";

type TestNode = { type: unknown; props: any };

async function readerHtml(): Promise<string> {
  const { UNSAFE_root } = render(<TrustVersion />);
  return waitFor(() => {
    const div = UNSAFE_root.findAll(
      (n: TestNode) =>
        n.type === ("div" as never) &&
        typeof n.props.className === "string" &&
        n.props.className.startsWith("mentible-reader"),
    )[0];
    if (!div) throw new Error("reader not yet rendered");
    return div.props.dangerouslySetInnerHTML.__html as string;
  });
}

it("renders section bodies through the reader on web: diagrams draw, raw fences don't", async () => {
  const html = await readerHtml();
  expect(html).toContain('class="mermaid"');
  expect(html).toContain('class="anim-svg"');
  expect(html).not.toContain("```mermaid");
  expect(html).not.toContain("```svg");
  // The raw fenced body never shows up as a literal Text node the old
  // `<Text>{s.body}</Text>` render would have produced.
  expect(screen.queryByText(MERMAID_BODY)).toBeNull();
  expect(screen.queryByText(SVG_BODY)).toBeNull();
});

it("renders one aggregate source-chip row for the whole draft", async () => {
  await readerHtml();
  expect(screen.getByText("S1")).toBeTruthy();
  expect(screen.getByText("S2")).toBeTruthy();
});

it("still shows editable TextInputs in edit mode", async () => {
  await readerHtml();
  fireEvent.press(screen.getByLabelText("Edit draft"));
  await waitFor(() => expect(screen.getByLabelText("Section 1 body")).toBeTruthy());
  expect(screen.getByLabelText("Section 1 heading")).toBeTruthy();
});
