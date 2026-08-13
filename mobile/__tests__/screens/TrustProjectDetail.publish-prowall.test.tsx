import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";
import { ApiError } from "@/api/client";

// Export Pro-wall (T3): a Free user's Download EPUB/PDF controls are replaced
// by an "Upgrade to Pro" control; Add-to-Library and text/MD copy stay
// available regardless of plan. The client wall is UX only — a fetch failure
// or unknown plan (plan:null) must fail OPEN (show the download controls as
// today; the server still enforces on 402).

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ projectId: "p1" }),
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
  useFocusEffect: (cb: () => void) => cb(),
}));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));

let mockPlan: { is_pro: boolean } | null = null;
jest.mock("@/hooks/useBillingPlan", () => ({
  useBillingPlan: () => ({ plan: mockPlan, loading: false }),
}));

const mockAlert = jest.fn();
jest.mock("@/lib/alert", () => ({ Alert: { alert: (...args: unknown[]) => mockAlert(...args) } }));

const mockCopyText = jest.fn(async (_t: string) => {});
jest.mock("@/lib/clipboard", () => ({ copyText: (t: string) => mockCopyText(t) }));
const mockSaveBook = jest.fn(async (_b: unknown) => {});
jest.mock("@/storage/bookStore", () => ({ saveBook: (b: unknown) => mockSaveBook(b) }));
const mockTrackedExport = jest.fn(async (_book: unknown, _fmt: string, _opts: unknown) => ({ artifact: new ArrayBuffer(8) }));
jest.mock("@/lib/trackedExport", () => ({ trackedExport: (book: unknown, fmt: string, opts: unknown) => mockTrackedExport(book, fmt, opts) }));
const mockDownloadArtifact = jest.fn(async (_bytes: ArrayBuffer, _filename: string, _mime: string) => ({}));
jest.mock("@/storage/epubLibrary", () => ({
  downloadArtifact: (bytes: ArrayBuffer, filename: string, mime: string) => mockDownloadArtifact(bytes, filename, mime),
}));

import { useTrustProject } from "@/hooks/useTrustProject";

const loadVersionContent = jest.fn(async () => ({
  id: "v1", artifact_id: "art", version_no: 2,
  content: { sections: [{ heading: "H", body: "B", source_ids: [] }] },
  generation_meta: null, is_validated: true, recorded_via: "expert_self", created_at: null, feedback: [],
}));

const inputs = [{ id: "i" }];

const projectData = {
  project: {
    project: { id: "p1", title: "Medicare", topic: null },
    my_role: "owner",
    inputs,
    artifacts: [
      { artifact: { id: "art", title: "Chapter outline", role: "cornerstone", format: "book" }, versions: [{ id: "v1", version_no: 2, is_validated: true, recorded_via: "expert_self" }] },
      { artifact: { id: "art2", title: "LinkedIn post", role: "derivative", format: "linkedin" }, versions: [{ id: "v2", version_no: 1, is_validated: true, recorded_via: "expert_self" }] },
    ],
  },
  loading: false, error: null, refresh: jest.fn(), loadVersionContent, inputs,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPlan = null;
});

it("Pro plan — Download EPUB/PDF controls are present", async () => {
  mockPlan = { is_pro: true };
  (useTrustProject as jest.Mock).mockReturnValue(projectData);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));

  expect(screen.getByLabelText("Download Chapter outline as EPUB")).toBeTruthy();
  expect(screen.getByLabelText("Download Chapter outline as PDF")).toBeTruthy();
  expect(screen.queryByLabelText(/Upgrade to Pro/)).toBeNull();
});

it("unknown plan (fetch failed / signed out) — fails open, shows download controls", async () => {
  mockPlan = null;
  (useTrustProject as jest.Mock).mockReturnValue(projectData);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));

  expect(screen.getByLabelText("Download Chapter outline as EPUB")).toBeTruthy();
  expect(screen.getByLabelText("Download Chapter outline as PDF")).toBeTruthy();
  expect(screen.queryByLabelText(/Upgrade to Pro/)).toBeNull();
});

it("Free plan — download replaced by an Upgrade control; Add to Library + copy stay available", async () => {
  mockPlan = { is_pro: false };
  (useTrustProject as jest.Mock).mockReturnValue(projectData);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));

  // long-form asset: download gone, upgrade control shown, Add to Library kept
  expect(screen.queryByLabelText("Download Chapter outline as EPUB")).toBeNull();
  expect(screen.queryByLabelText("Download Chapter outline as PDF")).toBeNull();
  expect(screen.getByLabelText("Add Chapter outline to Library")).toBeTruthy();
  const upgradeBtn = screen.getByLabelText("Upgrade to Pro to download Chapter outline");
  expect(upgradeBtn).toBeTruthy();

  // social asset: text/MD copy stays available regardless of plan
  expect(screen.getByLabelText("Copy LinkedIn post as text")).toBeTruthy();

  fireEvent.press(upgradeBtn);
  expect(mockPush).toHaveBeenCalledWith("/usage");
});

it("a 402 on an export submit shows an upgrade prompt (belt-and-suspenders)", async () => {
  // plan unknown → the client wall doesn't block, so the download control is
  // still shown; the server (T2) is the one that 402s.
  mockPlan = null;
  mockTrackedExport.mockRejectedValueOnce(new ApiError(402, JSON.stringify({ detail: "Pro plan required" })));
  (useTrustProject as jest.Mock).mockReturnValue(projectData);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));

  fireEvent.press(screen.getByLabelText("Download Chapter outline as EPUB"));

  await waitFor(() => expect(mockAlert).toHaveBeenCalled());
  const [title] = mockAlert.mock.calls[0] as [string, string];
  expect(title).toBe("Upgrade to Pro");
});
