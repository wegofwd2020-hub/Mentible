import React from "react";
import { render, screen } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: "p1" }), useRouter: () => ({ back: jest.fn() }) }));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: (_t: string, _m: string, btns?: { style?: string; onPress?: () => void }[]) => { btns?.find((b) => b.style !== "cancel")?.onPress?.(); } } }));
import { useTrustProject } from "@/hooks/useTrustProject";

const proj = (my_role: string) => ({
  project: {
    project: { id: "p1", title: "P", topic: null },
    my_role,
    inputs: [],
    artifacts: [{ artifact: { id: "art", title: "Guide", role: "cornerstone", format: "book" }, versions: [] }],
  },
  loading: false,
  error: null,
  refresh: jest.fn(),
  approve: jest.fn().mockResolvedValue({ recorded_via: "operator" }),
  addArtifact: jest.fn().mockResolvedValue({ id: "a2" }),
  addVersion: jest.fn().mockResolvedValue({ id: "v2" }),
  invite: jest.fn().mockResolvedValue({}),
});

beforeEach(() => jest.clearAllMocks());

it("renders the Project journey stepper with all four phases", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(proj("owner"));
  render(<TrustProjectDetail />);
  expect(await screen.findByLabelText("Project journey")).toBeTruthy();
  expect(screen.getByText("Capture")).toBeTruthy();
  expect(screen.getByText("Create")).toBeTruthy();
  expect(screen.getByText("Validate")).toBeTruthy();
  expect(screen.getByText("Share")).toBeTruthy();
});
