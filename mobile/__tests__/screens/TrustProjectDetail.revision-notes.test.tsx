import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ projectId: "p1" }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useFocusEffect: (cb: () => void) => cb(),
}));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: null, loading: false }) }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));

const mockListProjectFeedback = jest.fn();
jest.mock("@/api/trustClient", () => ({
  listProjectFeedback: (projectId: string, token: string) => mockListProjectFeedback(projectId, token),
}));

import { useTrustProject } from "@/hooks/useTrustProject";

const base = (opts: { role?: string } = {}) => ({
  project: {
    project: { id: "p1", title: "Stormwater", topic: null, toc: undefined },
    my_role: opts.role ?? "owner",
    artifacts: [
      {
        artifact: { id: "art", title: "Guide", role: "cornerstone", format: "book" },
        versions: [{ id: "v1", version_no: 1, created_at: null, is_validated: false, recorded_via: null }],
      },
    ],
    inputs: [],
    topic_status: [],
    book_validated: false,
  },
  loading: false,
  error: null,
  refresh: jest.fn(),
  generateFormat: jest.fn(),
  generateTopic: jest.fn(),
  invite: jest.fn(),
  addInput: jest.fn(),
  editInput: jest.fn(),
  removeInput: jest.fn(),
  loadVersionContent: jest.fn(),
  suggestToc: jest.fn(),
  saveToc: jest.fn(),
  inputs: [],
  accessToken: "tok",
});

beforeEach(() => jest.clearAllMocks());

it("shows revision notes across drafts (artifact + topic sources), in received (newest-first) order", async () => {
  mockListProjectFeedback.mockResolvedValue([
    {
      source: "artifact", draft_label: "Guide", format: "book", version_no: 2,
      author_kind: "expert", author_name: "Dana", body: "Tighten the intro.", created_at: "2026-08-02T00:00:00Z",
    },
    {
      source: "topic", draft_label: "Topic One", format: null, version_no: 1,
      author_kind: "operator", author_name: null, body: "Needs a diagram.", created_at: "2026-08-01T00:00:00Z",
    },
  ]);
  (useTrustProject as jest.Mock).mockReturnValue(base());
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Feedback:/));

  expect(await screen.findByText("Revision notes")).toBeTruthy();
  expect(mockListProjectFeedback).toHaveBeenCalledWith("p1", "tok");

  expect(await screen.findByText("Guide · v2")).toBeTruthy();
  expect(screen.getByText("Tighten the intro.")).toBeTruthy();
  expect(screen.getByText(/Dana/)).toBeTruthy();

  expect(screen.getByText("Topic One · v1")).toBeTruthy();
  expect(screen.getByText("Needs a diagram.")).toBeTruthy();
  expect(screen.getByText(/^operator/)).toBeTruthy();
});

it("shows the empty state when there are no revision notes", async () => {
  mockListProjectFeedback.mockResolvedValue([]);
  (useTrustProject as jest.Mock).mockReturnValue(base());
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Feedback:/));

  expect(await screen.findByText("No revision notes yet.")).toBeTruthy();
});

it("fails open — a rejected fetch renders the empty state, never crashes the panel", async () => {
  mockListProjectFeedback.mockRejectedValue(new Error("network"));
  (useTrustProject as jest.Mock).mockReturnValue(base());
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Feedback:/));

  expect(await screen.findByText("No revision notes yet.")).toBeTruthy();
});
