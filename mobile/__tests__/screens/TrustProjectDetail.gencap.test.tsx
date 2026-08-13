import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";
import { ApiError } from "@/api/client";

// Free generation cap (T4): a Free user at the generation cap gets the
// whole-book "Start a new draft" cards, the per-topic Generate/Regenerate
// buttons, and the Structure "Suggest from sources" button all disabled with
// a "Free limit reached" hint. A 402 from any of the three generate submits
// (belt-and-suspenders — the server is the real gate) shows a distinct
// "Upgrade to Pro" Alert, not the generic "Couldn't generate"/"Couldn't
// suggest" message. The client wall is UX only — plan:null (unknown) must
// fail OPEN, never disable.

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ projectId: "p1" }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useFocusEffect: (cb: () => void) => cb(),
}));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));

let mockPlan: { is_pro: boolean; at_generation_cap: boolean } | null = null;
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: mockPlan, loading: false }) }));

const mockAlert = jest.fn();
jest.mock("@/lib/alert", () => ({ Alert: { alert: (...args: unknown[]) => mockAlert(...args) } }));

import { useTrustProject } from "@/hooks/useTrustProject";

const toc = {
  subjects: [
    {
      subject_label: "Fundamentals",
      units: [
        { id: "t1", title: "Topic One", subtopics: [], prerequisites: [] },
        { id: "t2", title: "Topic Two", subtopics: [], prerequisites: [] },
      ],
    },
  ],
};

const topicStatus = [
  { topic_id: "t1", status: "drafted", latest_version_id: "tv1", version_no: 1 },
  { topic_id: "t2", status: "not_generated" },
];

const sourceInputs = [
  { id: "i1", kind: "note", title: "Kickoff notes", content: "We discussed scope.", source_ref: null, created_at: "2026-07-01T00:00:00Z" },
];

const base = (opts: { withToc?: boolean } = {}) => {
  const withToc = opts.withToc ?? true;
  return {
    project: {
      project: { id: "p1", title: "Stormwater", topic: null, toc: withToc ? toc : undefined },
      my_role: "owner",
      artifacts: [{ artifact: { id: "art", title: "Guide", role: "cornerstone", format: "book" }, versions: [] }],
      inputs: sourceInputs,
      topic_status: withToc ? topicStatus : [],
    },
    loading: false,
    error: null,
    refresh: jest.fn(),
    generateFormat: jest.fn().mockResolvedValue({ id: "v9" }),
    generateTopic: jest.fn().mockResolvedValue({ id: "tv2" }),
    suggestToc: jest.fn().mockResolvedValue({ subjects: [] }),
    saveToc: jest.fn().mockResolvedValue(undefined),
    invite: jest.fn(),
    addInput: jest.fn(),
    editInput: jest.fn(),
    removeInput: jest.fn(),
    inputs: sourceInputs,
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPlan = null;
});

// --- Whole-book Drafts ---

it("unknown plan (fetch failed) — whole-book Start-a-new-draft stays enabled (fail open)", async () => {
  mockPlan = null;
  (useTrustProject as jest.Mock).mockReturnValue(base());
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));

  const btn = await screen.findByLabelText("Start a new LinkedIn post draft");
  expect(btn.props.accessibilityState?.disabled).toBeFalsy();
  expect(screen.queryByText("Free limit reached — upgrade to Pro")).toBeNull();
});

it("Free plan at the generation cap — whole-book Start-a-new-draft is disabled with a hint", async () => {
  mockPlan = { is_pro: false, at_generation_cap: true };
  (useTrustProject as jest.Mock).mockReturnValue(base());
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));

  const btn = await screen.findByLabelText("Start a new LinkedIn post draft");
  expect(btn.props.accessibilityState?.disabled).toBe(true);
  expect(screen.getByText("Free limit reached — upgrade to Pro")).toBeTruthy();
});

it("Pro plan — whole-book Start-a-new-draft stays enabled even if at_generation_cap is somehow set", async () => {
  mockPlan = { is_pro: true, at_generation_cap: true };
  (useTrustProject as jest.Mock).mockReturnValue(base());
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));

  const btn = await screen.findByLabelText("Start a new LinkedIn post draft");
  expect(btn.props.accessibilityState?.disabled).toBeFalsy();
});

it("a 402 on a whole-book generate submit shows an upgrade prompt (belt-and-suspenders)", async () => {
  mockPlan = null; // client wall doesn't block; the server 402s
  const mock = base();
  mock.generateFormat = jest.fn().mockRejectedValue(new ApiError(402, JSON.stringify({ detail: "Free plan generation limit reached" })));
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  fireEvent.press(await screen.findByLabelText("Start a new LinkedIn post draft"));

  await waitFor(() => expect(mockAlert).toHaveBeenCalled());
  const [title] = mockAlert.mock.calls[0] as [string, string];
  expect(title).toBe("Upgrade to Pro");
});

// --- Per-topic Drafts ---

it("Free plan at the generation cap — per-topic Generate is disabled with a hint", async () => {
  mockPlan = { is_pro: false, at_generation_cap: true };
  (useTrustProject as jest.Mock).mockReturnValue(base());
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  fireEvent.press(await screen.findByLabelText("Per topic"));

  const btn = await screen.findByLabelText("Generate Topic Two");
  expect(btn.props.accessibilityState?.disabled).toBe(true);
  expect(screen.getAllByText("Free limit reached — upgrade to Pro").length).toBeGreaterThan(0);
});

it("unknown plan — per-topic Generate stays enabled (fail open)", async () => {
  mockPlan = null;
  (useTrustProject as jest.Mock).mockReturnValue(base());
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  fireEvent.press(await screen.findByLabelText("Per topic"));

  const btn = await screen.findByLabelText("Generate Topic Two");
  expect(btn.props.accessibilityState?.disabled).toBeFalsy();
});

it("a 402 on a per-topic generate submit shows an upgrade prompt", async () => {
  mockPlan = null;
  const mock = base();
  mock.generateTopic = jest.fn().mockRejectedValue(new ApiError(402, JSON.stringify({ detail: "Free plan generation limit reached" })));
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  fireEvent.press(await screen.findByLabelText("Per topic"));
  fireEvent.press(await screen.findByLabelText("Generate Topic Two"));

  await waitFor(() => expect(mockAlert).toHaveBeenCalled());
  const [title] = mockAlert.mock.calls[0] as [string, string];
  expect(title).toBe("Upgrade to Pro");
});

// --- Structure: Suggest from sources ---

it("Free plan at the generation cap — Suggest from sources is disabled with a hint", async () => {
  mockPlan = { is_pro: false, at_generation_cap: true };
  (useTrustProject as jest.Mock).mockReturnValue(base({ withToc: false }));
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Structure:/));

  const btn = await screen.findByLabelText("Suggest outline from sources");
  expect(btn.props.accessibilityState?.disabled).toBe(true);
  expect(screen.getByText("Free limit reached — upgrade to Pro")).toBeTruthy();
});

it("unknown plan — Suggest from sources stays enabled (fail open)", async () => {
  mockPlan = null;
  (useTrustProject as jest.Mock).mockReturnValue(base({ withToc: false }));
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Structure:/));

  const btn = await screen.findByLabelText("Suggest outline from sources");
  expect(btn.props.accessibilityState?.disabled).toBeFalsy();
});

it("a 402 on the Suggest submit shows an upgrade prompt", async () => {
  mockPlan = null;
  const mock = base({ withToc: false });
  mock.suggestToc = jest.fn().mockRejectedValue(new ApiError(402, JSON.stringify({ detail: "Free plan generation limit reached" })));
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Structure:/));
  fireEvent.press(await screen.findByLabelText("Suggest outline from sources"));

  await waitFor(() => expect(mockAlert).toHaveBeenCalled());
  const [title] = mockAlert.mock.calls[0] as [string, string];
  expect(title).toBe("Upgrade to Pro");
});
