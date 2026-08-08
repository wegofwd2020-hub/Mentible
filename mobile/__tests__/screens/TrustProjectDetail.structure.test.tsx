import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: "p1" }), useRouter: () => ({ back: jest.fn() }), useFocusEffect: (cb: () => void) => cb() }));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
// Not auto-confirming (unlike the sibling TrustProjectDetail.*.test.tsx files)
// — the confirm-replace tests below need to drive Cancel vs Replace
// themselves, so `Alert.alert` is a bare spy here and each button's onPress
// is invoked explicitly from the captured call.
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));
import { useTrustProject } from "@/hooks/useTrustProject";
import { Alert } from "@/lib/alert";

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
afterEach(() => jest.useRealTimers());

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
  // No existing content to lose, so no confirm prompt was needed.
  expect(Alert.alert).not.toHaveBeenCalled();
});

it("owner with an existing outline: Suggest shows a confirm-replace prompt before overwriting, and Cancel keeps the current outline", async () => {
  const mock = proj("owner", { toc: seededToc });
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);

  fireEvent.press(await screen.findByLabelText(/Structure:/));
  expect(await screen.findByDisplayValue("Kinematics")).toBeTruthy();

  fireEvent.press(screen.getByLabelText("Suggest outline from sources"));
  await waitFor(() => expect(mock.suggestToc).toHaveBeenCalled());
  await waitFor(() =>
    expect(Alert.alert).toHaveBeenCalledWith("Replace outline?", expect.any(String), expect.any(Array)),
  );

  // The prompt fired BEFORE anything was applied or persisted.
  expect(screen.queryByDisplayValue("Bonds")).toBeNull();
  expect(mock.saveToc).not.toHaveBeenCalled();

  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as { style?: string; onPress?: () => void }[];
  act(() => buttons.find((b) => b.style === "cancel")?.onPress?.());

  // Cancel: the current outline is untouched and nothing was ever saved.
  expect(screen.getByDisplayValue("Kinematics")).toBeTruthy();
  expect(screen.queryByDisplayValue("Bonds")).toBeNull();
  expect(mock.saveToc).not.toHaveBeenCalled();
});

it("owner with an existing outline: confirming Replace applies and persists the suggested outline", async () => {
  const mock = proj("owner", { toc: seededToc });
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);

  fireEvent.press(await screen.findByLabelText(/Structure:/));
  await screen.findByDisplayValue("Kinematics");
  fireEvent.press(screen.getByLabelText("Suggest outline from sources"));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalled());

  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as { style?: string; onPress?: () => void }[];
  act(() => buttons.find((b) => b.style !== "cancel")?.onPress?.());

  expect(await screen.findByDisplayValue("Bonds")).toBeTruthy();
  await waitFor(() => expect(mock.saveToc).toHaveBeenCalledWith(expect.objectContaining({ subjects: expect.any(Array) })));
});

it("owner: editing the tree debounces the persisted saveToc (not one PATCH per keystroke)", async () => {
  const mock = proj("owner", { toc: seededToc });
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);

  fireEvent.press(await screen.findByLabelText(/Structure:/));
  const titleInput = await screen.findByLabelText("Topic 1.1 title");

  jest.useFakeTimers();
  fireEvent.changeText(titleInput, "M");
  fireEvent.changeText(titleInput, "Mo");
  fireEvent.changeText(titleInput, "Mot");
  fireEvent.changeText(titleInput, "Motion");

  // Nothing persisted yet — still within the debounce window.
  act(() => jest.advanceTimersByTime(400));
  expect(mock.saveToc).not.toHaveBeenCalled();

  // Past the debounce window: exactly one save, carrying the LATEST value.
  act(() => jest.advanceTimersByTime(500));
  expect(mock.saveToc).toHaveBeenCalledTimes(1);
  expect(mock.saveToc).toHaveBeenCalledWith(
    expect.objectContaining({
      subjects: [expect.objectContaining({ units: [expect.objectContaining({ title: "Motion" })] })],
    }),
  );
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

it("reviewer sees the TOC read-only: no Suggest and edits never persist (phase nav still allowed)", async () => {
  const mock = proj("reviewer", { toc: seededToc });
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);

  fireEvent.press(await screen.findByLabelText(/Structure:/));
  expect(await screen.findByDisplayValue("Kinematics")).toBeTruthy();
  // No editing affordance for a reviewer...
  expect(screen.queryByLabelText("Suggest outline from sources")).toBeNull();
  const titleInput = screen.queryByLabelText("Topic 1.1 title");
  if (titleInput) fireEvent.changeText(titleInput, "Hacked");
  expect(mock.saveToc).not.toHaveBeenCalled();

  // ...but the wizard Back/Next is pure navigation, available to everyone.
  expect(screen.getByLabelText("Next to Drafts")).toBeTruthy();
  fireEvent.press(screen.getByLabelText("Next to Drafts"));
  expect((await screen.findByLabelText(/Drafts:/)).props.accessibilityState.selected).toBe(true);
});

it("tolerates a persisted subject missing `units` (defensive backend payload) without crashing", async () => {
  // PUT /toc only validates that `subjects` is a list, not that every
  // subject has a `units` array — a hand-crafted payload could omit it.
  const noUnits = { subjects: [{ subject_label: "Physics" }] };
  const mock = proj("owner", { toc: noUnits });
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);

  fireEvent.press(await screen.findByLabelText(/Structure:/));
  expect(await screen.findByDisplayValue("Physics")).toBeTruthy();
});
