import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

jest.mock("expo-router", () => {
  const React_ = require("react");
  const { Text } = require("react-native");
  return {
    // Real useFocusEffect runs on focus (once), not every render — model that with
    // a mount effect so a callback that sets state can't loop.
    useFocusEffect: (cb: () => void) => {
      React_.useEffect(() => cb(), []);
    },
    Redirect: ({ href }: { href: string }) => React_.createElement(Text, null, `redirect:${href}`),
  };
});

jest.mock("@/auth/AuthProvider", () => ({
  useAuth: () => ({ status: "signed_in", accessToken: "t", session: null }),
}));

let mockAccount: { is_super_admin: boolean } | null = { is_super_admin: true };
jest.mock("@/hooks/useAccount", () => ({
  useAccount: () => ({ account: mockAccount }),
}));

jest.mock("@/api/adminClient", () => ({
  listFeedback: jest.fn(async () => ({
    rows: [
      {
        id: "1",
        name: "Alice",
        email: "alice@x.com",
        app: "mentible",
        page: "/settings",
        type: "bug",
        contact_preference: "feedback_only",
        company: null,
        role: null,
        snippet: "hi",
        created_at: "2026-09-06T00:00:00Z",
        archived: false,
      },
      {
        id: "2",
        name: "Bob",
        email: "bob@y.com",
        app: "mentible",
        page: "/library",
        type: "feature",
        contact_preference: "email_follow_up",
        company: null,
        role: null,
        snippet: "would be nice",
        created_at: "2026-09-05T00:00:00Z",
        archived: false,
      },
    ],
    next_cursor: null,
  })),
  getFeedback: jest.fn(async () => ({
    id: "1",
    name: "Alice",
    email: "alice@x.com",
    app: "mentible",
    page: "/settings",
    type: "bug",
    contact_preference: "feedback_only",
    company: null,
    role: null,
    snippet: "hi",
    created_at: "2026-09-06T00:00:00Z",
    archived: false,
    text: "full text here",
    payload: { type: "bug" },
  })),
  setFeedbackArchived: jest.fn(async () => {}),
  deleteFeedback: jest.fn(async () => {}),
  feedbackExportUrl: jest.fn(() => "http://x/export"),
}));

// The delete confirm goes through @/lib/alert. In the test, auto-press the
// destructive (non-cancel) button so doDelete runs.
jest.mock("@/lib/alert", () => ({
  Alert: {
    alert: (_t: string, _m?: string, buttons?: { style?: string; onPress?: () => void }[]) => {
      const action = buttons?.find((b) => b.style !== "cancel");
      action?.onPress?.();
    },
  },
}));

const { getFeedback, setFeedbackArchived, deleteFeedback } = require("@/api/adminClient") as {
  getFeedback: jest.Mock;
  setFeedbackArchived: jest.Mock;
  deleteFeedback: jest.Mock;
};

import AdminFeedbackScreen from "../../app/admin/feedback";

beforeEach(() => {
  jest.clearAllMocks();
  mockAccount = { is_super_admin: true };
});

describe("AdminFeedbackScreen", () => {
  it("lists feedback rows for a super-admin", async () => {
    render(<AdminFeedbackScreen />);
    expect(await screen.findByText("alice@x.com")).toBeTruthy();
    expect(screen.getByText("bob@y.com")).toBeTruthy();
  });

  it("opens a detail modal with the full text on row tap", async () => {
    render(<AdminFeedbackScreen />);
    await screen.findByText("alice@x.com");
    fireEvent.press(screen.getByLabelText("View feedback from alice@x.com"));
    expect(await screen.findByText("full text here")).toBeTruthy();
    expect(getFeedback).toHaveBeenCalledWith("t", "1");
  });

  it("archives a row and removes it from the active list", async () => {
    render(<AdminFeedbackScreen />);
    await screen.findByText("alice@x.com");
    const archiveBtns = screen.getAllByLabelText("Archive feedback");
    fireEvent.press(archiveBtns[0]);
    expect(setFeedbackArchived).toHaveBeenCalledWith("t", "1", true);
    // active view: the archived row drops out, the other stays
    await screen.findByText("bob@y.com");
    expect(screen.queryByText("alice@x.com")).toBeNull();
  });

  it("hard-deletes a row after confirming", async () => {
    render(<AdminFeedbackScreen />);
    await screen.findByText("alice@x.com");
    const deleteBtns = screen.getAllByLabelText("Delete feedback");
    fireEvent.press(deleteBtns[0]);
    expect(deleteFeedback).toHaveBeenCalledWith("t", "1");
    await screen.findByText("bob@y.com");
    expect(screen.queryByText("alice@x.com")).toBeNull();
  });

  it("redirects a non-admin to settings", async () => {
    // Access control is the redirect + the backend `require_feedback_viewer`
    // 403 — NOT the client withholding the fetch. The list load is intentionally
    // not gated on `isAdmin` (so a slow/failing /account can't hang the screen on
    // a spinner), so a non-admin may fire one 403'd request before the redirect;
    // what matters is that they never SEE data, which the redirect guarantees.
    mockAccount = { is_super_admin: false };
    render(<AdminFeedbackScreen />);
    expect(await screen.findByText("redirect:/settings")).toBeTruthy();
  });
});
