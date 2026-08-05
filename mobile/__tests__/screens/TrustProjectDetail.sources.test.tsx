import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: "p1" }), useRouter: () => ({ back: jest.fn() }) }));
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
