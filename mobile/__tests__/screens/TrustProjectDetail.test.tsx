import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";

jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: "p1" }), useRouter: () => ({ back: jest.fn() }) }));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
// auto-press the non-cancel button of any Alert confirm
jest.mock("@/lib/alert", () => ({ Alert: { alert: (_t: string, _m: string, btns?: { style?: string; onPress?: () => void }[]) => { const b = btns?.find((x) => x.style !== "cancel"); b?.onPress?.(); } } }));
import { useTrustProject } from "@/hooks/useTrustProject";

const base = {
  project: { project: { id: "p1", title: "Stormwater", topic: null }, my_role: "reviewer",
    artifacts: [{ artifact: { id: "art", title: "Guide", role: "cornerstone", format: "book" },
      versions: [{ id: "v1", version_no: 1, is_validated: true }, { id: "v2", version_no: 2, is_validated: false }] }] },
  loading: false, error: null, refresh: jest.fn(),
};

beforeEach(() => { jest.clearAllMocks(); });

it("shows validated + awaiting badges and approves an awaiting version", async () => {
  const approve = jest.fn().mockResolvedValue({ recorded_via: "expert_self" });
  (useTrustProject as jest.Mock).mockReturnValue({ ...base, approve });
  render(<TrustProjectDetail />);
  expect(await screen.findByText("Stormwater")).toBeTruthy();
  fireEvent.press(screen.getByLabelText(/Feedback:/));
  expect(screen.getByLabelText("Version 1 validated")).toBeTruthy();
  fireEvent.press(screen.getByLabelText("Approve version 2"));
  await waitFor(() => expect(approve).toHaveBeenCalledWith("v2"));
});
