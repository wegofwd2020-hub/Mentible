import React from "react";
import { StyleSheet } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ projectId: "p1" }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  useFocusEffect: (cb: () => void) => cb(),
}));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
jest.mock("@/lib/alert", () => ({
  Alert: {
    alert: (_t: string, _m: string, btns?: { style?: string; onPress?: () => void }[]) => {
      btns?.find((b) => b.style !== "cancel")?.onPress?.();
    },
  },
}));
import { useTrustProject } from "@/hooks/useTrustProject";

const sourceInputs = [
  { id: "i1", kind: "note", title: "Kickoff notes", content: "We discussed scope.", source_ref: null, created_at: null },
];

const base = {
  project: {
    project: { id: "p1", title: "Stormwater", topic: null, toc: undefined },
    my_role: "owner",
    artifacts: [
      {
        artifact: { id: "art", title: "Guide", role: "cornerstone", format: "book" },
        versions: [
          { id: "v1", version_no: 1, created_at: null, is_validated: true, recorded_via: "expert_self" },
          { id: "v2", version_no: 2, created_at: null, is_validated: false, recorded_via: null },
        ],
      },
    ],
    inputs: sourceInputs,
  },
  loading: false,
  error: null,
  refresh: jest.fn(),
  approve: jest.fn(),
  addArtifact: jest.fn(),
  generateFormat: jest.fn(),
  invite: jest.fn(),
  addInput: jest.fn(),
  editInput: jest.fn(),
  removeInput: jest.fn(),
  suggestToc: jest.fn(),
  saveToc: jest.fn(),
  loadVersionContent: jest.fn(),
  inputs: sourceInputs,
};

beforeEach(() => jest.clearAllMocks());

// Asserts a rendered <Text> node never carries the retired bold (700) weight —
// the Studio primitives (Button/Label) top out at 500.
function expectNotBold(text: ReturnType<typeof screen.getByText>) {
  expect(StyleSheet.flatten(text.props.style).fontWeight).not.toBe("700");
}

it("titles the project in Playfair and carries no bold (700) weight on the migrated Studio controls", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base);
  render(<TrustProjectDetail />);

  // (a) heading face: Playfair, not the retired Fraunces.
  const title = await screen.findByText("Stormwater");
  expect(StyleSheet.flatten(title.props.style).fontFamily).toMatch(/Playfair/);

  // (b) no migrated control carries fontWeight: "700" — scoped to the
  // Button/Label instances this task actually moved onto the primitives.

  // Input tab: "Add source" <Button>.
  fireEvent.press(screen.getByLabelText(/Input:/));
  expectNotBold(screen.getByText("Add source"));

  // Structure tab: "Suggest from sources" + "Next" <Button>s.
  fireEvent.press(screen.getByLabelText(/Structure:/));
  expectNotBold(screen.getByText("Suggest from sources"));
  expectNotBold(screen.getByText("Next"));

  // Drafts tab: the "Compare…" toggle <Button variant="ghost">
  // (versions.length >= 2 in this fixture).
  fireEvent.press(screen.getByLabelText(/Drafts:/));
  expectNotBold(screen.getByText("Compare…"));

  // Feedback tab: "Invite" <Button>.
  fireEvent.press(screen.getByLabelText(/Feedback:/));
  expectNotBold(screen.getByText("Invite"));

  // Publish tab: "Add to Library" / "Download EPUB" / "Download PDF" <Button>s
  // (the v1 validated version makes this artifact publishable).
  fireEvent.press(screen.getByLabelText(/Publish:/));
  expectNotBold(screen.getByText("Add to Library"));
  expectNotBold(screen.getByText("Download EPUB"));
  expectNotBold(screen.getByText("Download PDF"));
});
