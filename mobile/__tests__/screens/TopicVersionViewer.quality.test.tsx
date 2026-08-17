import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

// QualityCard wiring on the per-topic version screen (P1-4 T6 fix round 1):
// - the card must actually render INSIDE the screen with a live `quality`
//   payload from `getTopicVersion`
// - the owner's "Run grounding check" button must call `runTopicGroundingCheck`
//   (the topic client fn, NOT the artifact one) with THIS version id
// - a reviewer must never see the button, but MUST see the per-section
//   quality note in view mode (fix round 1 item 2 — a reviewer needs to see
//   which section has a coverage/grounding issue before approving, ADR-037)

let mockRole = "owner";
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "tv1", projectId: "p1" }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({
    project: { my_role: mockRole },
    approveTopic: jest.fn(),
    withdrawTopic: jest.fn(),
    generateTopic: jest.fn(),
    editTopic: jest.fn(),
    listTopicVersions: jest.fn(async () => []),
    addTopicFeedback: jest.fn(),
  }),
}));
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: null, loading: false }) }));
jest.mock("@/secure/keyStore", () => ({ loadApiKey: jest.fn().mockResolvedValue("sk-ant-x") }));
jest.mock("react-native-webview", () => ({ default: () => null }));
jest.mock("@/components/LessonRenderer", () => require("../../test-utils/mockTopicRenderer"));

const mockRunTopicGroundingCheck = jest.fn();
jest.mock("@/api/trustClient", () => ({
  getTopicVersion: jest.fn(async () => ({
    id: "tv1", topic_id: "t1", title: "Reading music",
    content: { sections: [{ heading: "Staff", body: "5 lines", source_ids: [] }] },
    version_no: 1, created_at: null, is_validated: false, recorded_via: null,
    generation_meta: null, feedback: [],
    quality: {
      coverage: { sections_total: 5, sections_cited: 4, uncited_section_indexes: [0], dangling: [], source_refs: 4 },
      readability: { flesch_reading_ease: 52.1, grade_level: 9.4, words: 300, sentences: 20 },
      grounding: null,
    },
  })),
  runTopicGroundingCheck: (...args: unknown[]) => mockRunTopicGroundingCheck(...args),
}));
jest.mock("@/api/pollJob", () => ({ pollJob: jest.fn(async () => ({})) }));

import { pollJob } from "@/api/pollJob";
import TopicVersionViewer from "@/../app/trust/topic-version/[id]";

beforeEach(() => {
  mockRole = "owner";
  jest.clearAllMocks();
  mockRunTopicGroundingCheck.mockResolvedValue({ job_id: "job-2", status: "queued" });
});

it("renders the QualityCard's coverage/readability summary from the live version's quality payload", async () => {
  render(<TopicVersionViewer />);
  await waitFor(() => expect(screen.getByText("4/5 sections cite a source")).toBeTruthy());
  expect(screen.getByText(/Grade 9.4/)).toBeTruthy();
});

it("owner sees Run grounding check, and pressing it calls runTopicGroundingCheck with THIS version's id", async () => {
  mockRole = "owner";
  render(<TopicVersionViewer />);
  await waitFor(() => expect(screen.getByLabelText("Run grounding check")).toBeTruthy());

  fireEvent.press(screen.getByLabelText("Run grounding check"));

  await waitFor(() => expect(mockRunTopicGroundingCheck).toHaveBeenCalledWith(
    "tv1", { api_key: "sk-ant-x", provider_id: "anthropic" }, "tok",
  ));
  await waitFor(() => expect(pollJob).toHaveBeenCalledWith(
    "job-2", "tok", expect.objectContaining({ intervalMs: expect.any(Number) }),
  ));
});

it("reviewer does not see Run grounding check, but does see the per-section quality note in view mode", async () => {
  mockRole = "reviewer";
  render(<TopicVersionViewer />);
  await waitFor(() => expect(screen.getByText("4/5 sections cite a source")).toBeTruthy());
  expect(screen.queryByLabelText("Run grounding check")).toBeNull();
  expect(screen.getByText("Section quality")).toBeTruthy();
  expect(screen.getByText("uncited")).toBeTruthy();
});
