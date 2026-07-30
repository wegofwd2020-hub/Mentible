import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: "p1" }), useRouter: () => ({ back: jest.fn(), push: mockPush }) }));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: (_t: string, _m: string, btns?: { style?: string; onPress?: () => void }[]) => { btns?.find((b) => b.style !== "cancel")?.onPress?.(); } } }));
import { useTrustProject } from "@/hooks/useTrustProject";

const proj = (my_role: string, inputs: unknown[] = [], versions: unknown[] = []) => ({
  project: {
    project: { id: "p1", title: "P", topic: null },
    my_role,
    inputs,
    artifacts: [{ artifact: { id: "art", title: "Guide", role: "cornerstone", format: "book" }, versions }],
  },
  loading: false,
  error: null,
  refresh: jest.fn(),
  approve: jest.fn().mockResolvedValue({ recorded_via: "operator" }),
  addArtifact: jest.fn().mockResolvedValue({ id: "a2" }),
  addVersion: jest.fn().mockResolvedValue({ id: "v2" }),
  invite: jest.fn().mockResolvedValue({}),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPush.mockClear();
});

it("renders the Project journey stepper with all four phases", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(proj("owner"));
  render(<TrustProjectDetail />);
  expect(await screen.findByLabelText("Project journey")).toBeTruthy();
  expect(screen.getByText("Capture")).toBeTruthy();
  expect(screen.getByText("Create")).toBeTruthy();
  expect(screen.getByText("Validate")).toBeTruthy();
  expect(screen.getByText("Share")).toBeTruthy();
});

it("on a validated project, pressing the next-step opens the Posts tab", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(
    proj("owner", [{ id: "in1", kind: "note", title: "Notes", content: "hi", created_at: null }], [{ id: "v1", version_no: 1, is_validated: true, recorded_via: "operator" }]),
  );
  render(<TrustProjectDetail />);
  const nextBtn = await screen.findByLabelText(/Go to next step/i);
  fireEvent.press(nextBtn);
  expect(mockPush).toHaveBeenCalledWith("/posts");
});

it("on a capture-phase project, pressing the next-step does not throw or navigate", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(proj("owner"));
  render(<TrustProjectDetail />);
  const nextBtn = await screen.findByLabelText(/Go to next step/i);
  expect(() => fireEvent.press(nextBtn)).not.toThrow();
  expect(mockPush).not.toHaveBeenCalled();
});
