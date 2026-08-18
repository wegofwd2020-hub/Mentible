import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";

jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: "p1" }), useRouter: () => ({ back: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => cb() }));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: null, loading: false }) }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));
import { useTrustProject } from "@/hooks/useTrustProject";
import { Alert } from "@/lib/alert";

const mockSaveRights = jest.fn(async () => {});

const base = (rights: { rights_attested_at: string | null; rights_holder: string | null }, role = "owner") => ({
  project: {
    project: { id: "p1", title: "Medicare", topic: null, ...rights },
    my_role: role,
    inputs: [],
    artifacts: [],
  },
  loading: false, error: null, refresh: jest.fn(), loadVersionContent: jest.fn(), inputs: [],
  saveRights: mockSaveRights,
});

beforeEach(() => jest.clearAllMocks());

it("owner sees the rights attestation control on Publish, unattested by default", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base({ rights_attested_at: null, rights_holder: null }));
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));
  expect(screen.getByLabelText("I attest I hold the rights to my sources")).toBeTruthy();
  expect(screen.getByText("Not attested")).toBeTruthy();
});

it("pressing the attestation checkbox calls saveRights with attested=true", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base({ rights_attested_at: null, rights_holder: null }));
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));
  fireEvent.press(screen.getByLabelText("I attest I hold the rights to my sources"));
  await waitFor(() => expect(mockSaveRights).toHaveBeenCalledWith(true, undefined));
});

it("saving a rights holder name calls saveRights with the current attested state", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base({ rights_attested_at: "2026-08-18T00:00:00Z", rights_holder: "Jane" }));
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));
  const input = screen.getByLabelText("Rights holder");
  fireEvent.changeText(input, "Jane Doe");
  fireEvent.press(screen.getByLabelText("Save rights holder"));
  await waitFor(() => expect(mockSaveRights).toHaveBeenCalledWith(true, "Jane Doe"));
});

it("shows the author-responsibility note to every role, and hides the attestation control from a reviewer", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base({ rights_attested_at: null, rights_holder: null }, "reviewer"));
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));
  expect(screen.getByText(/Originality & rights are the author's responsibility/)).toBeTruthy();
  expect(screen.queryByLabelText("I attest I hold the rights to my sources")).toBeNull();
});

it("shows a save error via Alert when saveRights rejects", async () => {
  mockSaveRights.mockRejectedValueOnce(new Error("network down"));
  (useTrustProject as jest.Mock).mockReturnValue(base({ rights_attested_at: null, rights_holder: null }));
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));
  fireEvent.press(screen.getByLabelText("I attest I hold the rights to my sources"));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith("Couldn't save", "network down"));
});
