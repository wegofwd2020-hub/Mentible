import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ projectId: "p1" }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: mockReplace }),
  useFocusEffect: (cb: () => void) => cb(),
}));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: null, loading: false }) }));
// Alert mock auto-presses the non-cancel (destructive) button.
jest.mock("@/lib/alert", () => ({
  Alert: {
    alert: (_t: string, _m: string, btns?: { style?: string; onPress?: () => void }[]) =>
      btns?.find((b) => b.style !== "cancel")?.onPress?.(),
  },
}));
import { useTrustProject } from "@/hooks/useTrustProject";

const removeProject = jest.fn().mockResolvedValue(undefined);
const base = (my_role: string) => ({
  project: { project: { id: "p1", title: "P", topic: null }, my_role, inputs: [], artifacts: [] },
  loading: false, error: null, refresh: jest.fn(), inputs: [],
  editInput: jest.fn(), removeInput: jest.fn(), transcribeAudio: jest.fn(), removeProject,
});

beforeEach(() => jest.clearAllMocks());

it("owner can delete the project -> calls removeProject and navigates to /projects", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base("owner"));
  render(<TrustProjectDetail />);
  const btn = await screen.findByLabelText("Delete project");
  fireEvent.press(btn);
  // Alert auto-confirms; removeProject resolves then replace('/projects')
  await new Promise((r) => setTimeout(r, 0));
  expect(removeProject).toHaveBeenCalledTimes(1);
  expect(mockReplace).toHaveBeenCalledWith("/projects");
});

it("a reviewer does not see the delete button", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base("reviewer"));
  render(<TrustProjectDetail />);
  await screen.findByLabelText("Back to Home");
  expect(screen.queryByLabelText("Delete project")).toBeNull();
});
