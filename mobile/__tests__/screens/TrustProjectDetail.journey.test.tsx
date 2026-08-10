import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: "p1" }), useRouter: () => ({ back: jest.fn(), push: mockPush }), useFocusEffect: (cb: () => void) => cb() }));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: (_t: string, _m: string, btns?: { style?: string; onPress?: () => void }[]) => { btns?.find((b) => b.style !== "cancel")?.onPress?.(); } } }));
import { useTrustProject } from "@/hooks/useTrustProject";

const proj = (my_role: string, inputs: unknown[] = [], versions: unknown[] = []) => ({
  project: {
    project: { id: "p1", title: "P", topic: null },
    my_role,
    inputs,
    artifacts: [{ artifact: { id: "art", title: "Guide", role: "cornerstone", format: "book" }, versions }],
  },
  loading: false,
  error: null,
  refresh: jest.fn(),
  approve: jest.fn().mockResolvedValue({ recorded_via: "operator" }),
  addArtifact: jest.fn().mockResolvedValue({ id: "a2" }),
  addVersion: jest.fn().mockResolvedValue({ id: "v2" }),
  generateVersion: jest.fn().mockResolvedValue({ id: "v2" }),
  invite: jest.fn().mockResolvedValue({}),
  // Mirror useTrustProject's real shape (inputs = project?.inputs ?? []) — see
  // TrustProjectDetail.generate.test.tsx, which sets both the same way.
  inputs,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPush.mockClear();
});

it("auto-selects the current phase on load (no input → Input)", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(proj("owner"));
  render(<TrustProjectDetail />);
  // Input tab is selected, and its add-source control is visible.
  expect((await screen.findByLabelText(/Input:/)).props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText("Add source")).toBeTruthy();
});

it("tapping the Drafts tab switches to the drafts panel", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(proj("owner", [{ id: "i" }]));
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  expect(screen.getByLabelText("Start a new LinkedIn post draft")).toBeTruthy();
});

it("a reviewer auto-lands on Feedback and can open a version to review", async () => {
  // Approve now lives ON the draft view (slice 2) — Feedback lists versions and
  // opens each one, rather than approving inline.
  (useTrustProject as jest.Mock).mockReturnValue(
    proj("reviewer", [{ id: "i" }], [{ id: "v1", version_no: 1, is_validated: false, recorded_via: null }]),
  );
  render(<TrustProjectDetail />);
  expect((await screen.findByLabelText(/Feedback:/)).props.accessibilityState.selected).toBe(true);
  expect(screen.queryByLabelText(/Approve version 1/)).toBeNull();
  fireEvent.press(screen.getByLabelText("Open version 1"));
  expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ versionId: "v1" }) }));
});

it("keeps the recorded_via chip on a validated version (Feedback)", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(
    proj("owner", [{ id: "i" }], [{ id: "v1", version_no: 1, is_validated: true, recorded_via: "expert_self" }]),
  );
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Feedback:/));
  expect(screen.getByText("expert-validated")).toBeTruthy();
});

it("the Publish tab lists an approved long-form asset with library/export actions", async () => {
  // "Guide" is format "book" (long-form) — Publish now offers Add to Library +
  // Download EPUB/PDF for it, not Copy (Copy stays for social formats).
  (useTrustProject as jest.Mock).mockReturnValue(
    proj("owner", [{ id: "i" }], [{ id: "v1", version_no: 1, is_validated: true, recorded_via: "operator" }]),
  );
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));
  expect(screen.getByLabelText("Add Guide to Library")).toBeTruthy();
  expect(screen.getByLabelText("Download Guide as EPUB")).toBeTruthy();
  expect(screen.getByLabelText("Download Guide as PDF")).toBeTruthy();
});

it("does not yank the owner off Input after adding the first source", async () => {
  const initial = proj("owner", []);
  (useTrustProject as jest.Mock).mockReturnValue(initial);
  const { rerender } = render(<TrustProjectDetail />);
  expect((await screen.findByLabelText(/Input:/)).props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText("Add source")).toBeTruthy();

  // Simulate the refresh a first addInput triggers: the hook now returns a
  // project with one input, which advances the derived phase past Input
  // into Drafts. The selected tab must stay on Input regardless.
  (useTrustProject as jest.Mock).mockReturnValue(
    proj("owner", [{ id: "i1", kind: "note", title: "Kickoff notes", content: "We discussed scope.", source_ref: null, created_at: null }]),
  );
  rerender(<TrustProjectDetail />);

  expect((await screen.findByLabelText(/Input:/)).props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText("Add source")).toBeTruthy();
});

it("a phase not reachable yet shows a finish-prior-phase note instead of actions", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(proj("owner")); // no versions yet → Feedback is unreachable
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Feedback:/));
  expect(screen.queryByLabelText(/Approve version/)).toBeNull();
  expect(screen.getByText(/first/i)).toBeTruthy();
});
