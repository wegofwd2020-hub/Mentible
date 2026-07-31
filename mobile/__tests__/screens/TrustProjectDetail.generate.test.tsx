import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: "p1" }), useRouter: () => ({ back: jest.fn() }) }));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: (_t: string, _m: string, btns?: { style?: string; onPress?: () => void }[]) => { btns?.find((b) => b.style !== "cancel")?.onPress?.(); } } }));
import { useTrustProject } from "@/hooks/useTrustProject";

const sourceInputs = [
  { id: "i1", kind: "note", title: "Kickoff notes", content: "We discussed scope and timeline.", source_ref: null, created_at: "2026-07-01T00:00:00Z" },
];

const proj = (hasInputs: boolean) => ({
  project: {
    project: { id: "p1", title: "P", topic: null },
    my_role: "owner",
    artifacts: [{ artifact: { id: "art", title: "Guide", role: "cornerstone", format: "book" }, versions: [] }],
    inputs: hasInputs ? sourceInputs : [],
  },
  loading: false,
  error: null,
  refresh: jest.fn(),
  approve: jest.fn(),
  addArtifact: jest.fn(),
  generateVersion: jest.fn().mockResolvedValue({ id: "v9" }),
  invite: jest.fn(),
  addInput: jest.fn(),
  inputs: hasInputs ? sourceInputs : [],
});

beforeEach(() => jest.clearAllMocks());

it("owner with a source sees Generate a draft and pressing it calls generateVersion", async () => {
  const mock = proj(true);
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);

  const btn = await screen.findByLabelText("Generate a draft");
  fireEvent.press(btn);

  await waitFor(() => {
    expect(mock.generateVersion).toHaveBeenCalledWith("art");
  });
});

it("disables Generate a draft and shows a hint when there are no sources yet", async () => {
  const mock = proj(false);
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);

  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  const btn = await screen.findByLabelText("Generate a draft");
  expect(btn.props.accessibilityState?.disabled).toBe(true);
  expect(screen.getByText(/add a source first/i)).toBeTruthy();

  fireEvent.press(btn);
  expect(mock.generateVersion).not.toHaveBeenCalled();
});
