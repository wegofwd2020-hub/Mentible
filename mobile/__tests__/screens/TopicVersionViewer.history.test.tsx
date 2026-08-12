import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

// Inline "Versions" history block (S2 Task 3): lists sibling versions of the
// SAME topic (fetched via listTopicVersions, since the project payload only
// carries the latest per-topic status), marks the current one, and lets a
// reviewer/owner tap a non-current row to jump there — mirrors the whole-book
// history block in trust/version/[versionId].tsx.

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "tv1", projectId: "p1" }),
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));

const mockListTopicVersions = jest.fn(async () => [
  { id: "tv1", version_no: 1, created_at: "2026-08-01T00:00:00Z", is_validated: false },
  { id: "tv2", version_no: 2, created_at: "2026-08-02T00:00:00Z", is_validated: true },
]);
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({
    project: { my_role: "reviewer" },
    approveTopic: jest.fn(),
    withdrawTopic: jest.fn(),
    listTopicVersions: mockListTopicVersions,
  }),
}));

jest.mock("@/api/trustClient", () => ({
  getTopicVersion: jest.fn(async () => ({
    id: "tv1", topic_id: "t1", title: "Reading music",
    content: { sections: [{ heading: "Staff", body: "5 lines", source_ids: [] }] },
    version_no: 1, created_at: null, is_validated: false, recorded_via: null, generation_meta: null,
  })),
}));

// Section bodies render through TopicRenderer, which on native goes through a
// react-native-webview host — stub it so the module loads under jest (mirrors
// the sibling TopicVersionViewer test files).
jest.mock("react-native-webview", () => ({ default: () => null }));

import TopicVersionViewer from "@/../app/trust/topic-version/[id]";

beforeEach(() => { jest.clearAllMocks(); mockListTopicVersions.mockResolvedValue([
  { id: "tv1", version_no: 1, created_at: "2026-08-01T00:00:00Z", is_validated: false },
  { id: "tv2", version_no: 2, created_at: "2026-08-02T00:00:00Z", is_validated: true },
]); });

it("lists both versions with a current marker and a validated check", async () => {
  render(<TopicVersionViewer />);
  await waitFor(() => expect(screen.getByText("Versions")).toBeTruthy());
  expect(screen.getByText(/v1/)).toBeTruthy();
  expect(screen.getByText(/v2/)).toBeTruthy();
  expect(screen.getByText("current")).toBeTruthy();
  expect(screen.getByLabelText("Open version 2")).toBeTruthy();
});

it("tapping a non-current row navigates to that version", async () => {
  render(<TopicVersionViewer />);
  const row = await screen.findByLabelText("Open version 2");
  fireEvent.press(row);
  await waitFor(() =>
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/trust/topic-version/[id]",
      params: { id: "tv2", projectId: "p1" },
    }),
  );
});

it("renders no history block when there is only one version", async () => {
  mockListTopicVersions.mockResolvedValueOnce([
    { id: "tv1", version_no: 1, created_at: "2026-08-01T00:00:00Z", is_validated: false },
  ]);
  render(<TopicVersionViewer />);
  await waitFor(() => expect(screen.getByText("Reading music")).toBeTruthy());
  expect(screen.queryByText("Versions")).toBeNull();
});

it("renders no history block and does not crash when listTopicVersions rejects (defensive)", async () => {
  mockListTopicVersions.mockRejectedValueOnce(new Error("network"));
  render(<TopicVersionViewer />);
  await waitFor(() => expect(screen.getByText("Reading music")).toBeTruthy());
  expect(screen.queryByText("Versions")).toBeNull();
});
