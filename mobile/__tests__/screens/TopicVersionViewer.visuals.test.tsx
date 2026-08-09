import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";

// "per-topic visuals" T2: the per-topic draft viewer must render section
// bodies through the reader's proven render+sanitize pipeline (TopicRenderer
// → NativeTopicReader on web / the WebView doc on native), not plain <Text>,
// so ```mermaid / ```svg fences in a draft actually render as diagrams.

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "tv1", projectId: "p1" }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({ project: { my_role: "reviewer" }, approveTopic: jest.fn(), withdrawTopic: jest.fn() }),
}));

const SVG_BODY = '```svg\n<svg><rect width="10" height="10"/></svg>\n```';
const MERMAID_BODY = "```mermaid\ngraph TD; A-->B;\n```";
const LEGACY_IMAGE_BODY = "[IMAGE: a diagram of the cell]";

jest.mock("@/api/trustClient", () => ({
  getTopicVersion: jest.fn(async () => ({
    id: "tv1", topic_id: "t1", title: "Reading music",
    content: {
      sections: [
        { heading: "Diagram", body: SVG_BODY, source_ids: [] },
        { heading: "Flow", body: MERMAID_BODY, source_ids: [] },
        { heading: "Legacy figure", body: LEGACY_IMAGE_BODY, source_ids: [] },
      ],
    },
    version_no: 1, created_at: null, is_validated: true, recorded_via: "operator",
  })),
}));

// Stub the WebView so its `source.html` prop (the built document) is
// inspectable — jest can't execute the in-page script, but the embedded
// document text is enough to prove the draft reached the reader pipeline
// (mirrors __tests__/app/chapter-quiz.test.tsx and
// __tests__/components/topicSanitize.native.test.ts's approach).
jest.mock("react-native-webview", () => ({
  default: ({ source, accessibilityLabel }: { source?: { html?: string }; accessibilityLabel?: string }) => {
    const { Text } = require("react-native");
    return <Text accessibilityLabel={accessibilityLabel}>{source?.html ?? ""}</Text>;
  },
}));

import TopicVersionViewer from "@/../app/trust/topic-version/[id]";

// Pulls the rendered lesson HTML out of the WebView document exactly the way
// __tests__/components/contentHtml.test.ts's `embeddedHtml` does: the doc
// embeds `var DATA = ({ __html: "…" });` and the in-page script assigns
// DATA.__html via innerHTML — jest never runs that script, so parse the JSON
// directly instead.
function embeddedHtml(doc: string): string {
  const m = doc.match(/var DATA = (\{.*?\});\n/s);
  if (!m) throw new Error("no DATA embed found in the WebView document");
  return (JSON.parse(m[1]!) as { __html: string }).__html;
}

async function renderedDoc(): Promise<string> {
  render(<TopicVersionViewer />);
  return waitFor(() => {
    const node = screen.getByLabelText("Topic content");
    const doc = node.props.children as string;
    if (!doc) throw new Error("Topic content not yet rendered");
    return doc;
  });
}

it("keeps the title and validated badge", async () => {
  render(<TopicVersionViewer />);
  await waitFor(() => expect(screen.getByText("Reading music")).toBeTruthy());
  expect(screen.getByText(/Validated/i)).toBeTruthy();
  expect(screen.getByText(/operator-recorded/i)).toBeTruthy();
});

it("renders a ```mermaid fence as a rendered diagram marker, not raw fence text", async () => {
  const doc = await renderedDoc();
  expect(doc).not.toContain("```mermaid");
  expect(embeddedHtml(doc)).toContain('class="mermaid"');
  // The raw fenced body never shows up as a literal Text node the old
  // `<Text>{s.body}</Text>` render would have produced.
  expect(screen.queryByText(MERMAID_BODY)).toBeNull();
});

it("renders a ```svg fence as a rendered figure marker, not raw fence text", async () => {
  const doc = await renderedDoc();
  expect(doc).not.toContain("```svg");
  expect(embeddedHtml(doc)).toContain('class="anim-svg"');
  expect(screen.queryByText(SVG_BODY)).toBeNull();
});

it("renders a legacy [IMAGE: ...] section body as plain text without crashing", async () => {
  const doc = await renderedDoc();
  expect(embeddedHtml(doc)).toContain("[IMAGE: a diagram of the cell]");
});
