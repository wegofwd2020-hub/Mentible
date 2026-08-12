import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ projectId: "p1" }),
  useRouter: () => ({ back: jest.fn() }),
  useFocusEffect: (cb: () => void) => cb(),
}));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
import { useTrustProject } from "@/hooks/useTrustProject";

type Opts = {
  role: "owner" | "reviewer";
  inputs?: { id: string; kind: string; title: string | null; content: string; source_ref: string | null; created_at: string | null }[];
  toc?: { subjects: { subject_label: string; units: { id: string; title: string; subtopics: unknown[]; prerequisites: string[] }[] }[] };
  topicStatus?: { topic_id: string; status: "not_generated" | "drafted" | "validated" }[];
};

const mockHook = (opts: Opts) => ({
  project: {
    project: { id: "p1", title: "P", topic: null, toc: opts.toc },
    my_role: opts.role,
    artifacts: [],
    inputs: opts.inputs ?? [],
    topic_status: opts.topicStatus,
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
  inputs: opts.inputs ?? [],
  accessToken: "tok",
});

beforeEach(() => jest.clearAllMocks());

it("owner, 0 inputs: shows the Add-source banner and its CTA selects the Input tab", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(mockHook({ role: "owner", inputs: [] }));
  render(<TrustProjectDetail />);

  expect(await screen.findByText("Add your first source")).toBeTruthy();
  expect(screen.getByText(/The studio drafts only from what you provide/)).toBeTruthy();

  // Move away from the Input tab first so the CTA press is a real assertion,
  // not a no-op against the phase's own default landing.
  fireEvent.press(screen.getByLabelText(/^Structure:/));
  expect(screen.getByLabelText(/^Structure:/).props.accessibilityState.selected).toBe(true);

  fireEvent.press(screen.getByLabelText("Add a source"));
  expect(screen.getByLabelText(/^Input:/).props.accessibilityState.selected).toBe(true);
});

it("owner with a drafted topic: no banner", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(
    mockHook({
      role: "owner",
      inputs: [{ id: "i1", kind: "note", title: "a", content: "c", source_ref: null, created_at: null }],
      toc: { subjects: [{ subject_label: "S", units: [{ id: "t1", title: "T", subtopics: [], prerequisites: [] }] }] },
      topicStatus: [{ topic_id: "t1", status: "drafted" }],
    }),
  );
  render(<TrustProjectDetail />);

  await screen.findByLabelText(/^Input:/);
  expect(screen.queryByText("Add your first source")).toBeNull();
  expect(screen.queryByText("Suggest a structure")).toBeNull();
  expect(screen.queryByText("Generate your first topic")).toBeNull();
});

it("reviewer: no banner regardless of state", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(mockHook({ role: "reviewer", inputs: [] }));
  render(<TrustProjectDetail />);

  await screen.findByLabelText(/^Input:/);
  expect(screen.queryByText("Add your first source")).toBeNull();
});
