import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

// QualityCard wiring on the artifact-version screen (P1-4 T6 fix round 1):
// - the card must actually render INSIDE the screen with a live `quality`
//   payload from `getVersion` (not just the standalone QualityCard unit test)
// - the owner's "Run grounding check" button must call `runGroundingCheck`
//   (the artifact-version client fn, NOT the topic one) with THIS version id
// - a reviewer must never see the button

let mockRole = "owner";
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ versionId: "v1", artifactId: "a1", projectId: "p1" }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({
    project: { my_role: mockRole, inputs: [] },
    addVersion: jest.fn(),
    generateVersion: jest.fn(),
    approve: jest.fn(),
    unapprove: jest.fn(),
  }),
}));
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: null, loading: false }) }));
jest.mock("@/secure/keyStore", () => ({ loadApiKey: jest.fn().mockResolvedValue("sk-ant-x") }));
jest.mock("react-native-webview", () => ({ default: () => null }));
jest.mock("@/components/LessonRenderer", () => require("../../test-utils/mockTopicRenderer"));

const mockRunGroundingCheck = jest.fn();
const mockRunOriginalityCheck = jest.fn();
jest.mock("@/api/trustClient", () => ({
  getVersion: jest.fn(async () => ({
    id: "v1", artifact_id: "a1", version_no: 2,
    content: { sections: [{ heading: "H", body: "B", source_ids: [] }] },
    generation_meta: null, is_validated: false, recorded_via: null, created_at: null,
    feedback: [],
    quality: {
      coverage: { sections_total: 10, sections_cited: 8, uncited_section_indexes: [], dangling: [], source_refs: 8 },
      readability: { flesch_reading_ease: 45.3, grade_level: 11.2, words: 500, sentences: 30 },
      grounding: null,
      originality: null,
    },
  })),
  addFeedback: jest.fn(),
  runGroundingCheck: (...args: unknown[]) => mockRunGroundingCheck(...args),
  runOriginalityCheck: (...args: unknown[]) => mockRunOriginalityCheck(...args),
}));
jest.mock("@/api/pollJob", () => ({ pollJob: jest.fn(async () => ({})) }));

import { pollJob } from "@/api/pollJob";
import TrustVersion from "@/../app/trust/version/[versionId]";

beforeEach(() => {
  mockRole = "owner";
  jest.clearAllMocks();
  mockRunGroundingCheck.mockResolvedValue({ job_id: "job-1", status: "queued" });
  mockRunOriginalityCheck.mockResolvedValue({ job_id: "job-3", status: "queued" });
});

it("renders the QualityCard's coverage/readability summary from the live version's quality payload", async () => {
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("8/10 sections cite a source")).toBeTruthy());
  expect(screen.getByText(/Grade 11.2/)).toBeTruthy();
});

it("owner sees Run grounding check, and pressing it calls runGroundingCheck with THIS version's id", async () => {
  mockRole = "owner";
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByLabelText("Run grounding check")).toBeTruthy());

  fireEvent.press(screen.getByLabelText("Run grounding check"));

  await waitFor(() => expect(mockRunGroundingCheck).toHaveBeenCalledWith(
    "v1", { api_key: "sk-ant-x", provider_id: "anthropic" }, "tok",
  ));
  await waitFor(() => expect(pollJob).toHaveBeenCalledWith(
    "job-1", "tok", expect.objectContaining({ intervalMs: expect.any(Number) }),
  ));
});

it("reviewer does not see Run grounding check", async () => {
  mockRole = "reviewer";
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("8/10 sections cite a source")).toBeTruthy());
  expect(screen.queryByLabelText("Run grounding check")).toBeNull();
});

it("owner sees Run originality check, and pressing it calls runOriginalityCheck with THIS version's id", async () => {
  mockRole = "owner";
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByLabelText("Run originality check")).toBeTruthy());

  fireEvent.press(screen.getByLabelText("Run originality check"));

  await waitFor(() => expect(mockRunOriginalityCheck).toHaveBeenCalledWith(
    "v1", { api_key: "sk-ant-x", provider_id: "anthropic" }, "tok",
  ));
  await waitFor(() => expect(pollJob).toHaveBeenCalledWith(
    "job-3", "tok", expect.objectContaining({ intervalMs: expect.any(Number) }),
  ));
});

it("reviewer does not see Run originality check", async () => {
  mockRole = "reviewer";
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("8/10 sections cite a source")).toBeTruthy());
  expect(screen.queryByLabelText("Run originality check")).toBeNull();
});
