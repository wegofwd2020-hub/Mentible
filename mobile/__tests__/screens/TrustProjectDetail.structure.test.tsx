import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: "p1" }), useRouter: () => ({ back: jest.fn() }), useFocusEffect: (cb: () => void) => cb() }));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: (_t: string, _m: string, btns?: { style?: string; onPress?: () => void }[]) => { btns?.find((b) => b.style !== "cancel")?.onPress?.(); } } }));
import { useTrustProject } from "@/hooks/useTrustProject";

const sourceInputs = [
  { id: "i1", kind: "note", title: "Kickoff notes", content: "We discussed scope.", source_ref: null, created_at: null },
];

const seededToc = {
  subjects: [
    { subject_label: "Physics", units: [{ id: "u1", title: "Kinematics", subtopics: [], prerequisites: [] }] },
  ],
};

const suggestedToc = {
  subjects: [
    { subject_label: "Chemistry", units: [{ id: "u9", title: "Bonds", subtopics: [], prerequisites: [] }] },
  ],
};

const proj = (my_role: string, opts?: { toc?: object; inputs?: typeof sourceInputs }) => {
  const inputs = opts?.inputs ?? sourceInputs;
  return {
    project: {
      project: { id: "p1", title: "P", topic: null, toc: opts?.toc },
      my_role,
      artifacts: [{ artifact: { id: "art", title: "Guide", role: "cornerstone", format: "book" }, versions: [] }],
      inputs,
    },
    loading: false,
    error: null,
    refresh: jest.fn(),
    approve: jest.fn(),
    addArtifact: jest.fn(),
    generateFormat: jest.fn(),
    invite: jest.fn(),
    addInput: jest.fn(),
    suggestToc: jest.fn().mockResolvedValue(suggestedToc),
    saveToc: jest.fn().mockResolvedValue(undefined),
    inputs,
  };
};

beforeEach(() => jest.clearAllMocks());

it("owner: pressing Suggest calls suggestToc, renders the result, and persists via saveToc", async () => {
  const mock = proj("owner"); // no seeded toc -> empty draft, no confirm prompt in the way
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);

  fireEvent.press(await screen.findByLabelText(/Structure:/));
  const suggestBtn = await screen.findByLabelText("Suggest outline from sources");
  fireEvent.press(suggestBtn);

  await waitFor(() => expect(mock.suggestToc).toHaveBeenCalled());
  expect(await screen.findByDisplayValue("Bonds")).toBeTruthy();
  await waitFor(() => expect(mock.saveToc).toHaveBeenCalledWith(expect.objectContaining({ subjects: expect.any(Array) })));
});

it("owner: editing the tree calls saveToc", async () => {
  const mock = proj("owner", { toc: seededToc });
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);

  fireEvent.press(await screen.findByLabelText(/Structure:/));
  fireEvent.changeText(await screen.findByLabelText("Topic 1.1 title"), "Motion");

  await waitFor(() => expect(mock.saveToc).toHaveBeenCalled());
});

it("owner: Next advances to the Drafts tab", async () => {
  const mock = proj("owner", { toc: seededToc });
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);

  fireEvent.press(await screen.findByLabelText(/Structure:/));
  fireEvent.press(await screen.findByLabelText("Next to Drafts"));

  expect((await screen.findByLabelText(/Drafts:/)).props.accessibilityState.selected).toBe(true);
});

it("Suggest is disabled with a hint when there are no sources yet", async () => {
  const mock = proj("owner", { inputs: [] });
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);

  fireEvent.press(await screen.findByLabelText(/Structure:/));
  const btn = await screen.findByLabelText("Suggest outline from sources");
  expect(btn.props.accessibilityState?.disabled).toBe(true);
  expect(screen.getByText(/add a source first/i)).toBeTruthy();

  fireEvent.press(btn);
  expect(mock.suggestToc).not.toHaveBeenCalled();
});

it("reviewer sees the TOC read-only: no Suggest/Next controls, and edits never persist", async () => {
  const mock = proj("reviewer", { toc: seededToc });
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);

  fireEvent.press(await screen.findByLabelText(/Structure:/));
  expect(await screen.findByDisplayValue("Kinematics")).toBeTruthy();
  expect(screen.queryByLabelText("Suggest outline from sources")).toBeNull();
  expect(screen.queryByLabelText("Next to Drafts")).toBeNull();

  const titleInput = screen.queryByLabelText("Topic 1.1 title");
  if (titleInput) fireEvent.changeText(titleInput, "Hacked");
  expect(mock.saveToc).not.toHaveBeenCalled();
});
