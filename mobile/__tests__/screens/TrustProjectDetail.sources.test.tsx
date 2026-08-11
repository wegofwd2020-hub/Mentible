import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: "p1" }), useRouter: () => ({ back: jest.fn() }), useFocusEffect: (cb: () => void) => cb() }));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: (_t: string, _m: string, btns?: { style?: string; onPress?: () => void }[]) => { btns?.find((b) => b.style !== "cancel")?.onPress?.(); } } }));
import { useTrustProject } from "@/hooks/useTrustProject";

const inputs = [
  { id: "i1", kind: "note", title: "Kickoff notes", content: "We discussed scope and timeline.", source_ref: null, created_at: "2026-07-01T00:00:00Z" },
];

const proj = (my_role: string) => ({
  project: { project: { id: "p1", title: "P", topic: null }, my_role, artifacts: [], inputs },
  loading: false, error: null, refresh: jest.fn(),
  approve: jest.fn(), addArtifact: jest.fn(), addVersion: jest.fn(), invite: jest.fn(),
  addInput: jest.fn().mockResolvedValue({ id: "i2" }),
  inputs,
});

beforeEach(() => jest.clearAllMocks());

it("owner sees the add-source form and can add a source", async () => {
  const mock = proj("owner");
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);

  fireEvent.press(await screen.findByLabelText(/Input:/));
  const addBtn = screen.getByLabelText("Add source");
  expect(addBtn).toBeTruthy();

  const contentInput = screen.getByPlaceholderText(/paste/i);
  fireEvent.changeText(contentInput, "A fresh transcript excerpt.");
  fireEvent.press(addBtn);

  await waitFor(() => {
    expect(mock.addInput).toHaveBeenCalledWith({ kind: "note", content: "A fresh transcript excerpt." });
  });
});

it("reviewer sees the source list but not the add form", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(proj("reviewer"));
  render(<TrustProjectDetail />);

  fireEvent.press(await screen.findByLabelText(/Input:/));
  expect(screen.getByText("Kickoff notes")).toBeTruthy();
  expect(screen.queryByLabelText("Add source")).toBeNull();
});

it("Link kind shows a URL field and hides the paste box; Add is gated on the URL", async () => {
  const mock = proj("owner");
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);

  fireEvent.press(await screen.findByLabelText(/Input:/));
  fireEvent.press(screen.getByLabelText("Source kind Link"));

  const urlInput = screen.getByLabelText("Source URL");
  expect(urlInput).toBeTruthy();
  expect(screen.queryByPlaceholderText(/paste/i)).toBeNull();

  const addBtn = screen.getByLabelText("Add source");
  expect(addBtn.props.accessibilityState?.disabled).toBe(true);

  fireEvent.changeText(urlInput, "https://example.com/article");
  expect(addBtn.props.accessibilityState?.disabled).toBe(false);

  fireEvent.press(addBtn);
  await waitFor(() => {
    expect(mock.addInput).toHaveBeenCalledWith({
      kind: "link",
      title: undefined,
      content: "https://example.com/article",
      source_ref: "https://example.com/article",
    });
  });
});

it("Note kind still sends { kind: 'note', content } with no source_ref", async () => {
  const mock = proj("owner");
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);

  fireEvent.press(await screen.findByLabelText(/Input:/));
  const contentInput = screen.getByPlaceholderText(/paste/i);
  fireEvent.changeText(contentInput, "Some note content.");
  fireEvent.press(screen.getByLabelText("Add source"));

  await waitFor(() => {
    expect(mock.addInput).toHaveBeenCalledWith({ kind: "note", content: "Some note content." });
  });
  const call = mock.addInput.mock.calls[mock.addInput.mock.calls.length - 1][0];
  expect(call.source_ref).toBeUndefined();
});
