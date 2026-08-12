import React from "react";
import { StyleSheet } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import PostsScreen, { assemblePost } from "@/../app/(tabs)/posts";

jest.mock("@/hooks/useMakePost", () => ({ useMakePost: jest.fn() }));
jest.mock("@/lib/clipboard", () => ({ copyText: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/secure/keyStore", () => ({ loadApiKey: jest.fn().mockResolvedValue("sk-ant-x") }));
jest.mock("@/lib/pickReferenceImage", () => ({ pickReferenceImage: jest.fn() }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));

import { useMakePost } from "@/hooks/useMakePost";
import { copyText } from "@/lib/clipboard";
import { pickReferenceImage } from "@/lib/pickReferenceImage";
import { Alert } from "@/lib/alert";

const VARIANTS = [
  { hook: "Hook 0", body: "Body 0", hashtags: ["#one"], cta: "Read more" },
  { hook: "Hook 1", body: "Body 1", hashtags: ["#two"], cta: null },
  { hook: "Hook 2", body: "Body 2", hashtags: ["#three"], cta: null },
];

function mockHook(over: Record<string, unknown>) {
  (useMakePost as jest.Mock).mockReturnValue({
    status: "idle", error: null, variants: [], provenance: null,
    run: jest.fn(), reset: jest.fn(), ...over,
  });
}

beforeEach(() => jest.clearAllMocks());

// Asserts a rendered <Text> node never carries the retired bold (700) weight —
// the Studio primitives (Button/Label) top out at 500.
function expectNotBold(text: ReturnType<typeof screen.getByText>) {
  expect(StyleSheet.flatten(text.props.style).fontWeight).not.toBe("700");
}

it("renders the post-variant hook in Fraunces and carries no bold (700) weight on the migrated Studio controls", () => {
  mockHook({ status: "done", variants: VARIANTS, provenance: "ai-generated" });
  render(<PostsScreen />);

  // (a) heading face: the variant "hook" is the card's Fraunces heading.
  const hook = screen.getByText("Hook 0");
  expect(StyleSheet.flatten(hook.props.style).fontFamily).toMatch(/Fraunces/);

  // (b) no migrated control carries fontWeight: "700" — the Copy <Button>,
  // the Make posts <Button variant="primary">, and the hook heading itself.
  expectNotBold(hook);
  expectNotBold(screen.getAllByText("Copy")[0]);
  expectNotBold(screen.getByText("Make posts"));
});

it("disables Generate until source text is entered", () => {
  mockHook({});
  render(<PostsScreen />);
  const btn = screen.getByLabelText("Make posts");
  expect(btn.props.accessibilityState?.disabled).toBe(true);
  fireEvent.changeText(screen.getByLabelText("Source text"), "Stormwater basics.");
  expect(screen.getByLabelText("Make posts").props.accessibilityState?.disabled).toBe(false);
});

it("renders 3 variant cards and the AI-generated tag when done", () => {
  mockHook({ status: "done", variants: VARIANTS, provenance: "ai-generated" });
  render(<PostsScreen />);
  expect(screen.getByText("Hook 0")).toBeTruthy();
  expect(screen.getByText("Hook 2")).toBeTruthy();
  expect(screen.getByText(/ai-generated/i)).toBeTruthy();
});

it("copies the assembled post when a Copy button is pressed", async () => {
  mockHook({ status: "done", variants: VARIANTS, provenance: "ai-generated" });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Copy post 1"));
  await waitFor(() => expect(copyText).toHaveBeenCalledWith(assemblePost(VARIANTS[0])));
});

it("shows the error text on failure", () => {
  mockHook({ status: "failed", error: "No API key saved. Go to Settings and paste your Anthropic key." });
  render(<PostsScreen />);
  expect(screen.getByText(/no api key saved/i)).toBeTruthy();
});

it("assemblePost joins hook, body, hashtags and cta", () => {
  expect(assemblePost(VARIANTS[0])).toBe("Hook 0\n\nBody 0\n\n#one\n\nRead more");
  expect(assemblePost(VARIANTS[1])).toBe("Hook 1\n\nBody 1\n\n#two");
});

it("attaching a reference image shows a thumbnail and passes it to run", async () => {
  const runMock = jest.fn();
  mockHook({ run: runMock });
  (pickReferenceImage as jest.Mock).mockResolvedValue({ media_type: "image/png", data: "AAA" });

  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Add reference image"));
  await screen.findByLabelText("Remove reference image");

  fireEvent.changeText(screen.getByLabelText("Source text"), "hello");
  fireEvent.press(screen.getByLabelText("Make posts"));

  expect(runMock).toHaveBeenCalledWith(
    expect.objectContaining({ image: { media_type: "image/png", data: "AAA" } }),
  );
});

it("removing a reference image clears the thumbnail", async () => {
  mockHook({});
  (pickReferenceImage as jest.Mock).mockResolvedValue({ media_type: "image/png", data: "AAA" });

  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Add reference image"));
  await screen.findByLabelText("Remove reference image");

  fireEvent.press(screen.getByLabelText("Remove reference image"));
  await screen.findByLabelText("Add reference image");
  expect(screen.queryByLabelText("Remove reference image")).toBeNull();
});

it("shows a friendly alert when picking a reference image fails", async () => {
  mockHook({});
  (pickReferenceImage as jest.Mock).mockRejectedValue(new Error("Only JPEG, PNG or WebP images are supported."));

  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Add reference image"));

  await waitFor(() =>
    expect(Alert.alert as jest.Mock).toHaveBeenCalledWith(
      "Could not add image",
      "Only JPEG, PNG or WebP images are supported.",
    ),
  );
});
