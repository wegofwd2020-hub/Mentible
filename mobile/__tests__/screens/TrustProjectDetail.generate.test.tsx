import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: "p1" }), useRouter: () => ({ back: jest.fn() }), useFocusEffect: (cb: () => void) => cb() }));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: (_t: string, _m: string, btns?: { style?: string; onPress?: () => void }[]) => { btns?.find((b) => b.style !== "cancel")?.onPress?.(); } } }));
import { useTrustProject } from "@/hooks/useTrustProject";

const sourceInputs = [
  { id: "i1", kind: "note", title: "Kickoff notes", content: "We discussed scope and timeline.", source_ref: null, created_at: "2026-07-01T00:00:00Z" },
];

const proj = (hasInputs: boolean) => ({
  project: {
    project: { id: "p1", title: "P", topic: null },
    my_role: "owner",
    artifacts: [{ artifact: { id: "art", title: "Guide", role: "cornerstone", format: "book" }, versions: [] }],
    inputs: hasInputs ? sourceInputs : [],
  },
  loading: false,
  error: null,
  refresh: jest.fn(),
  approve: jest.fn(),
  addArtifact: jest.fn(),
  generateVersion: jest.fn().mockResolvedValue({ id: "v9" }),
  generateFormat: jest.fn().mockResolvedValue({ id: "v9" }),
  invite: jest.fn(),
  addInput: jest.fn(),
  inputs: hasInputs ? sourceInputs : [],
});

beforeEach(() => jest.clearAllMocks());

// Updated for the GENERATE picker (was: single "Generate a draft" button per
// artifact, calling generateVersion). Now: 6 format cards, each calling
// generateFormat with the tapped DraftFormat.
it("owner with a source sees the format picker and pressing a card calls generateFormat", async () => {
  const mock = proj(true);
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);

  // No toc/version yet, so the derived current phase is now Structure
  // (skip-satisfied only by a toc or an existing version) — navigate to
  // Drafts explicitly, same as the sibling test below.
  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  const btn = await screen.findByLabelText("Start a new LinkedIn post draft");
  fireEvent.press(btn);

  await waitFor(() => {
    expect(mock.generateFormat).toHaveBeenCalledWith(expect.objectContaining({ format: "linkedin" }));
  });
});

// Task 2: whole-book Drafts labels — "start a new draft" (new artifact → v1)
// must read distinct from "regenerate" (new version on an existing draft).
it("labels the generate block 'Start a new draft' with a hint, and shows a 'Your drafts' header above existing drafts", async () => {
  const mock = proj(true);
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);

  fireEvent.press(await screen.findByLabelText(/Drafts:/));

  expect(screen.getByText("Start a new draft")).toBeTruthy();
  expect(
    screen.getByText(/Creates a fresh draft \(v1\)\. To make a new version of an existing draft, open it and Regenerate\./),
  ).toBeTruthy();
  // proj(true) seeds one artifact (with no versions), so the drafts list is
  // non-empty and the "Your drafts" header should render above it.
  expect(screen.getByText("Your drafts")).toBeTruthy();
});

it("disables the format cards and shows a hint when there are no sources yet", async () => {
  const mock = proj(false);
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);

  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  const btn = await screen.findByLabelText("Start a new LinkedIn post draft");
  expect(btn.props.accessibilityState?.disabled).toBe(true);
  expect(screen.getByText(/add a source first/i)).toBeTruthy();

  fireEvent.press(btn);
  expect(mock.generateFormat).not.toHaveBeenCalled();
});
