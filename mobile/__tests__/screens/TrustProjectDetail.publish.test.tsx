import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";

jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: "p1" }), useRouter: () => ({ back: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => cb() }));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
// plan:null (fail-open) — unrelated to this test's assertions; without this
// mock PublishPanel's useBillingPlan() would call the real useAuth(), which
// throws outside an AuthProvider.
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: null, loading: false }) }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));
const mockCopyText = jest.fn(async (_t: string) => {});
jest.mock("@/lib/clipboard", () => ({ copyText: (t: string) => mockCopyText(t) }));
import { useTrustProject } from "@/hooks/useTrustProject";

const loadVersionContent = jest.fn(async () => ({
  id: "v1", artifact_id: "art", version_no: 2,
  content: { sections: [{ heading: "Enrollment", body: "Sign up during IEP.", source_ids: [] }] },
  generation_meta: null, is_validated: true, recorded_via: "expert_self", created_at: null, feedback: [],
}));

// format "linkedin" (social, not long-form) — Publish keeps Copy/Copy-as-Markdown
// for it; long-form (book/essay/guide) actions are covered by
// TrustProjectDetail.publishbook.test.tsx.
const base = (versions: unknown[]) => ({
  project: {
    project: { id: "p1", title: "Medicare", topic: null },
    my_role: "owner",
    inputs: [{ id: "i" }],
    artifacts: [{ artifact: { id: "art", title: "Guide", role: "derivative", format: "linkedin" }, versions }],
  },
  loading: false, error: null, refresh: jest.fn(), loadVersionContent, inputs: [{ id: "i" }],
});

beforeEach(() => jest.clearAllMocks());

it("shows an empty state on Publish when nothing is validated", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base([{ id: "v1", version_no: 1, is_validated: false }]));
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));
  expect(screen.getByText(/approve a version under Feedback/i)).toBeTruthy();
});

it("copies an approved asset as text and as Markdown", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(
    base([{ id: "v1", version_no: 2, is_validated: true, recorded_via: "expert_self" }]),
  );
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));

  fireEvent.press(screen.getByLabelText("Copy Guide as text"));
  await waitFor(() => expect(loadVersionContent).toHaveBeenCalledWith("v1"));
  await waitFor(() => expect(mockCopyText).toHaveBeenCalledWith("Guide\n\nEnrollment\n\nSign up during IEP."));

  fireEvent.press(screen.getByLabelText("Copy Guide as Markdown"));
  await waitFor(() => expect(mockCopyText).toHaveBeenCalledWith("# Guide\n\n## Enrollment\n\nSign up during IEP."));
});
