import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";

// Whole-book "Generate full book" action (ADR-037 book generation, T5): a
// pre-run estimate/confirm before submitting the sequential fan-out over
// every still-missing TOC topic. Only shown to the owner once a TOC exists
// (DraftsPanel's whole-book view). Confirming resolves the BYOK key exactly
// like the other generators (loadApiKey; knownNotPro guard; apiKey ?? undefined)
// then submits via generateBook, keeping the returned job_id for Task 6's poller.

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

jest.mock("@/secure/keyStore", () => ({ loadApiKey: jest.fn() }));

const mockEstimateBook = jest.fn();
const mockGenerateBook = jest.fn();
jest.mock("@/api/trustClient", () => ({
  getTopicVersion: jest.fn(),
  listProjectFeedback: jest.fn(),
  estimateBook: (...args: unknown[]) => mockEstimateBook(...args),
  generateBook: (...args: unknown[]) => mockGenerateBook(...args),
}));

import { useTrustProject } from "@/hooks/useTrustProject";
import { loadApiKey } from "@/secure/keyStore";

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

const base = (opts: { role?: string; withToc?: boolean } = {}) => {
  const withToc = opts.withToc ?? true;
  return {
    project: {
      project: { id: "p1", title: "Stormwater", topic: null, toc: withToc ? toc : undefined },
      my_role: opts.role ?? "owner",
      artifacts: [],
      inputs: [{ id: "i1", kind: "note", title: "Kickoff notes", content: "x", source_ref: null, created_at: null }],
      topic_status: withToc ? [{ topic_id: "t1", status: "drafted" }, { topic_id: "t2", status: "not_generated" }] : [],
    },
    loading: false,
    error: null,
    refresh: jest.fn(),
    generateFormat: jest.fn(),
    generateTopic: jest.fn(),
    suggestToc: jest.fn(),
    saveToc: jest.fn(),
    invite: jest.fn(),
    addInput: jest.fn(),
    editInput: jest.fn(),
    removeInput: jest.fn(),
    inputs: [],
    accessToken: "tok",
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPlan = { is_pro: true, at_generation_cap: false };
  (loadApiKey as jest.Mock).mockResolvedValue(null);
});

it("shows Generate full book for the owner once a TOC exists", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base());
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));

  expect(await screen.findByLabelText("Generate full book")).toBeTruthy();
});

it("hides Generate full book when there is no TOC yet", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base({ withToc: false }));
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));

  expect(screen.queryByLabelText("Generate full book")).toBeNull();
});

it("hides Generate full book for a reviewer (non-owner)", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base({ role: "reviewer" }));
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));

  expect(screen.queryByLabelText("Generate full book")).toBeNull();
});

it("pressing Generate full book calls estimateBook then shows a confirm with the numbers", async () => {
  mockEstimateBook.mockResolvedValue({
    missing_topics: 2, est_input_tokens: 500, est_output_tokens_max: 16384,
    est_cost_micros_max: 450000, remaining_micros: 1000000, would_exceed: false,
  });
  (useTrustProject as jest.Mock).mockReturnValue(base());
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  fireEvent.press(await screen.findByLabelText("Generate full book"));

  await waitFor(() => expect(mockEstimateBook).toHaveBeenCalledWith("p1", "tok"));
  await waitFor(() => expect(mockAlert).toHaveBeenCalled());
  const [title, message] = mockAlert.mock.calls[0] as [string, string];
  expect(title).toMatch(/generate full book/i);
  expect(message).toContain("2");
  expect(message).toContain("16384");
  expect(message).toContain("0.45");
  expect(message).not.toMatch(/exceed/i);
});

it("shows an exceed warning in the confirm when would_exceed is true", async () => {
  mockEstimateBook.mockResolvedValue({
    missing_topics: 5, est_input_tokens: 500, est_output_tokens_max: 40960,
    est_cost_micros_max: 2000000, remaining_micros: 100000, would_exceed: true,
  });
  (useTrustProject as jest.Mock).mockReturnValue(base());
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  fireEvent.press(await screen.findByLabelText("Generate full book"));

  await waitFor(() => expect(mockAlert).toHaveBeenCalled());
  const [, message] = mockAlert.mock.calls[0] as [string, string];
  expect(message).toMatch(/exceed/i);
});

it("confirming submits generateBook with the resolved (keyless) key and stores the job_id", async () => {
  mockEstimateBook.mockResolvedValue({
    missing_topics: 2, est_input_tokens: 500, est_output_tokens_max: 16384,
    est_cost_micros_max: 450000, remaining_micros: null, would_exceed: false,
  });
  mockGenerateBook.mockResolvedValue({ job_id: "job-1", total: 2 });
  (loadApiKey as jest.Mock).mockResolvedValue(null);
  (useTrustProject as jest.Mock).mockReturnValue(base());
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  fireEvent.press(await screen.findByLabelText("Generate full book"));

  await waitFor(() => expect(mockAlert).toHaveBeenCalled());
  const buttons = mockAlert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
  const confirmBtn = buttons.find((b) => /generate/i.test(b.text) && b.text !== "Cancel");
  expect(confirmBtn).toBeTruthy();
  await waitFor(() => confirmBtn?.onPress?.());

  await waitFor(() => expect(mockGenerateBook).toHaveBeenCalledWith("p1", "tok", { apiKey: undefined }));
});

it("confirming with a saved BYOK key passes it through to generateBook", async () => {
  mockEstimateBook.mockResolvedValue({
    missing_topics: 1, est_input_tokens: 500, est_output_tokens_max: 8192,
    est_cost_micros_max: 100000, remaining_micros: null, would_exceed: false,
  });
  mockGenerateBook.mockResolvedValue({ job_id: "job-2", total: 1 });
  (loadApiKey as jest.Mock).mockResolvedValue("sk-ant-abc");
  (useTrustProject as jest.Mock).mockReturnValue(base());
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  fireEvent.press(await screen.findByLabelText("Generate full book"));

  await waitFor(() => expect(mockAlert).toHaveBeenCalled());
  const buttons = mockAlert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
  const confirmBtn = buttons.find((b) => /generate/i.test(b.text) && b.text !== "Cancel");
  await waitFor(() => confirmBtn?.onPress?.());

  await waitFor(() => expect(mockGenerateBook).toHaveBeenCalledWith("p1", "tok", { apiKey: "sk-ant-abc" }));
});

it("a Free plan with no saved key shows the 'add a key' error instead of submitting keyless", async () => {
  mockPlan = { is_pro: false, at_generation_cap: false };
  mockEstimateBook.mockResolvedValue({
    missing_topics: 1, est_input_tokens: 500, est_output_tokens_max: 8192,
    est_cost_micros_max: 100000, remaining_micros: null, would_exceed: false,
  });
  (loadApiKey as jest.Mock).mockResolvedValue(null);
  (useTrustProject as jest.Mock).mockReturnValue(base());
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  fireEvent.press(await screen.findByLabelText("Generate full book"));

  await waitFor(() => expect(mockAlert).toHaveBeenCalled());
  const buttons = mockAlert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
  const confirmBtn = buttons.find((b) => /generate/i.test(b.text) && b.text !== "Cancel");
  await waitFor(() => confirmBtn?.onPress?.());

  await waitFor(() => expect(mockAlert).toHaveBeenCalledTimes(2));
  expect(mockGenerateBook).not.toHaveBeenCalled();
});
