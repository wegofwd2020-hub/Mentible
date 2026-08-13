import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: "p1" }), useRouter: () => ({ back: jest.fn() }), useFocusEffect: (cb: () => void) => cb() }));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: null, loading: false }) }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: (_t: string, _m: string, btns?: { style?: string; onPress?: () => void }[]) => { btns?.find((b) => b.style !== "cancel")?.onPress?.(); } } }));
import { useTrustProject } from "@/hooks/useTrustProject";

const sourceInputs = [
  { id: "i1", kind: "note", title: "Kickoff notes", content: "We discussed scope and timeline.", source_ref: null, created_at: "2026-07-01T00:00:00Z" },
];

const proj = (hasInputs: boolean) => ({
  project: {
    project: { id: "p1", title: "P", topic: null },
    my_role: "owner",
    artifacts: [],
    inputs: hasInputs ? sourceInputs : [],
  },
  loading: false,
  error: null,
  refresh: jest.fn(),
  approve: jest.fn(),
  addArtifact: jest.fn(),
  generateVersion: jest.fn(),
  generateFormat: jest.fn().mockResolvedValue({ id: "v9" }),
  invite: jest.fn(),
  addInput: jest.fn(),
  inputs: hasInputs ? sourceInputs : [],
});

beforeEach(() => jest.clearAllMocks());

it("owner with a source sees the format picker and generating a format calls generateFormat", async () => {
  const mock = proj(true);
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);

  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  expect(screen.getByText("LinkedIn post")).toBeTruthy();
  expect(screen.getByText("Long-form essay")).toBeTruthy();

  fireEvent.press(screen.getByLabelText("Start a new LinkedIn post draft"));
  expect(mock.generateFormat).toHaveBeenCalledWith(
    expect.objectContaining({ format: "linkedin" }),
    expect.objectContaining({ onPhase: expect.any(Function) }),
  );
});

it("disables the format cards and shows a hint when there are no sources yet", async () => {
  const mock = proj(false);
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);

  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  const btn = await screen.findByLabelText("Start a new LinkedIn post draft");
  expect(btn.props.accessibilityState?.disabled).toBe(true);
  expect(screen.getByText(/add a source first/i)).toBeTruthy();

  fireEvent.press(btn);
  expect(mock.generateFormat).not.toHaveBeenCalled();
});
