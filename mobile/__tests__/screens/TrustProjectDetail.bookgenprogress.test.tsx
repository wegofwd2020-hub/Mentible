import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";

// Whole-book generation progress + on-return "ready" surface (ADR-037 book
// generation, T6): consumes the bookGenJobId T5 left set-but-unread. An
// active local job polls GET /generation-jobs/{id} (getGenerationJob) and
// renders "Generating chapters… {done}/{total}"; with no active local job,
// a project focus fetches the latest generation_job row (latestGenerationJob)
// and renders per its status — queued shows "Starting…", running shows the
// same progress line, done/halted show "Book generated ✓ (done/total ·
// failed)" listing the failed topic ids so the owner can regenerate them via
// the existing per-topic Generate, and failed shows "Generation failed — try
// again." (fix round, final-review Finding A) so a job caught mid-progress
// doesn't just vanish with no explanation. Any fetch error fails open: no
// surface, screen intact.

// Unlike the plain `(cb) => cb()` shape used elsewhere in this file's sibling
// tests, this mock fires the callback once per mount (via a real useEffect
// with an empty deps array) rather than on every render — a real
// useFocusEffect only re-invokes its callback on a genuine navigation focus
// event, not on every render, and firing on every render here would let a
// later render (e.g. once an active local job completes and bookGenJobId
// resets to null) spuriously re-run the on-focus latestGenerationJob fetch
// and clobber the just-rendered progress state with that mock's default.
jest.mock("expo-router", () => {
  const ReactActual = jest.requireActual("react");
  return {
    useLocalSearchParams: () => ({ projectId: "p1" }),
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    useFocusEffect: (cb: () => void) => {
      ReactActual.useEffect(() => {
        cb();
      }, []); // eslint-disable-line react-hooks/exhaustive-deps
    },
  };
});
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));

jest.mock("@/hooks/useBillingPlan", () => ({
  useBillingPlan: () => ({ plan: { is_pro: true, at_generation_cap: false }, loading: false }),
}));

const mockAlert = jest.fn();
jest.mock("@/lib/alert", () => ({ Alert: { alert: (...args: unknown[]) => mockAlert(...args) } }));

jest.mock("@/secure/keyStore", () => ({ loadApiKey: jest.fn() }));

const mockEstimateBook = jest.fn();
const mockGenerateBook = jest.fn();
const mockGetGenerationJob = jest.fn();
const mockLatestGenerationJob = jest.fn();
jest.mock("@/api/trustClient", () => ({
  getTopicVersion: jest.fn(),
  listProjectFeedback: jest.fn(),
  estimateBook: (...args: unknown[]) => mockEstimateBook(...args),
  generateBook: (...args: unknown[]) => mockGenerateBook(...args),
  getGenerationJob: (...args: unknown[]) => mockGetGenerationJob(...args),
  latestGenerationJob: (...args: unknown[]) => mockLatestGenerationJob(...args),
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

const mockRefresh = jest.fn();

const base = (opts: { role?: string } = {}) => ({
  project: {
    project: { id: "p1", title: "Stormwater", topic: null, toc },
    my_role: opts.role ?? "owner",
    artifacts: [],
    inputs: [{ id: "i1", kind: "note", title: "Kickoff notes", content: "x", source_ref: null, created_at: null }],
    topic_status: [{ topic_id: "t1", status: "drafted" }, { topic_id: "t2", status: "not_generated" }],
  },
  loading: false,
  error: null,
  refresh: mockRefresh,
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
});

const openDrafts = async () => {
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));
};

const runningJob = { id: "g1", project_id: "p1", status: "running", total: 2, done: 1, failed_topic_ids: [], created_at: null };
const doneJob = { id: "g1", project_id: "p1", status: "done", total: 2, done: 2, failed_topic_ids: ["t2"], created_at: null };
const failedJob = { id: "g1", project_id: "p1", status: "failed", total: 2, done: 0, failed_topic_ids: [], created_at: null };

beforeEach(() => {
  jest.clearAllMocks();
  (loadApiKey as jest.Mock).mockResolvedValue(null);
  mockGetGenerationJob.mockResolvedValue(runningJob);
  mockLatestGenerationJob.mockResolvedValue(null);
});

it("polls getGenerationJob for an active job and renders progress", async () => {
  mockEstimateBook.mockResolvedValue({
    missing_topics: 2, est_input_tokens: 500, est_output_tokens_max: 16384,
    est_cost_micros_max: 450000, remaining_micros: null, would_exceed: false,
  });
  mockGenerateBook.mockResolvedValue({ job_id: "job-1", total: 2 });
  (useTrustProject as jest.Mock).mockReturnValue(base());
  await openDrafts();
  fireEvent.press(await screen.findByLabelText("Generate full book"));

  await waitFor(() => expect(mockAlert).toHaveBeenCalled());
  const buttons = mockAlert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
  const confirmBtn = buttons.find((b) => /generate/i.test(b.text) && b.text !== "Cancel");
  await waitFor(() => confirmBtn?.onPress?.());

  await waitFor(() => expect(mockGetGenerationJob).toHaveBeenCalledWith("job-1", "tok"));
  expect(await screen.findByText("Generating chapters… 1/2")).toBeTruthy();
});

it("calls refresh() once the polled job reaches done", async () => {
  mockEstimateBook.mockResolvedValue({
    missing_topics: 2, est_input_tokens: 500, est_output_tokens_max: 16384,
    est_cost_micros_max: 450000, remaining_micros: null, would_exceed: false,
  });
  mockGenerateBook.mockResolvedValue({ job_id: "job-1", total: 2 });
  mockGetGenerationJob.mockResolvedValue(doneJob);
  (useTrustProject as jest.Mock).mockReturnValue(base());
  await openDrafts();
  fireEvent.press(await screen.findByLabelText("Generate full book"));

  await waitFor(() => expect(mockAlert).toHaveBeenCalled());
  const buttons = mockAlert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
  const confirmBtn = buttons.find((b) => /generate/i.test(b.text) && b.text !== "Cancel");
  await waitFor(() => confirmBtn?.onPress?.());

  await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  expect(await screen.findByText("Book generated ✓ (2/2 · 1 failed)")).toBeTruthy();
});

it("on focus with no active job, a done latest job renders the ready line with failed ids", async () => {
  mockLatestGenerationJob.mockResolvedValue(doneJob);
  (useTrustProject as jest.Mock).mockReturnValue(base());
  await openDrafts();

  expect(await screen.findByText("Book generated ✓ (2/2 · 1 failed)")).toBeTruthy();
  expect(await screen.findByText("Failed: t2")).toBeTruthy();
  expect(mockLatestGenerationJob).toHaveBeenCalledWith("p1", "tok");
});

it("on focus with no active job, a running latest job renders the progress line", async () => {
  mockLatestGenerationJob.mockResolvedValue(runningJob);
  (useTrustProject as jest.Mock).mockReturnValue(base());
  await openDrafts();

  expect(await screen.findByText("Generating chapters… 1/2")).toBeTruthy();
});

it("on focus with no active job, a failed latest job renders a 'try again' surface (final-review Finding A)", async () => {
  mockLatestGenerationJob.mockResolvedValue(failedJob);
  (useTrustProject as jest.Mock).mockReturnValue(base());
  await openDrafts();

  expect(await screen.findByText("Generation failed — try again.")).toBeTruthy();
  expect(screen.queryByText(/Generating chapters/)).toBeNull();
});

it("fails open on a latest-job fetch rejection — no surface, screen intact", async () => {
  mockLatestGenerationJob.mockRejectedValue(new Error("network down"));
  (useTrustProject as jest.Mock).mockReturnValue(base());
  await openDrafts();

  await waitFor(() => expect(mockLatestGenerationJob).toHaveBeenCalled());
  expect(screen.queryByText(/Generating chapters/)).toBeNull();
  expect(screen.queryByText(/Book generated/)).toBeNull();
  expect(await screen.findByLabelText("Generate full book")).toBeTruthy();
});
