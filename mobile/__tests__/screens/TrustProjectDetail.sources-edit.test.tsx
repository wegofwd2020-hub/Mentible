import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: "p1" }), useRouter: () => ({ back: jest.fn() }), useFocusEffect: (cb: () => void) => cb() }));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: null, loading: false }) }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: (_t: string, _m: string, btns?: { style?: string; onPress?: () => void }[]) => { btns?.find((b) => b.style !== "cancel")?.onPress?.(); } } }));
import { useTrustProject } from "@/hooks/useTrustProject";

const inputs = [
  { id: "i1", kind: "note", title: "T", content: "full body", source_ref: null, created_at: null },
];

const mockEditInput = jest.fn().mockResolvedValue({ id: "i1" });
const mockRemoveInput = jest.fn().mockResolvedValue(undefined);

const proj = (my_role: string) => ({
  project: { project: { id: "p1", title: "P", topic: null }, my_role, artifacts: [], inputs },
  loading: false, error: null, refresh: jest.fn(),
  approve: jest.fn(), addArtifact: jest.fn(), addVersion: jest.fn(), invite: jest.fn(),
  addInput: jest.fn().mockResolvedValue({ id: "i2" }),
  editInput: mockEditInput,
  removeInput: mockRemoveInput,
  inputs,
});

beforeEach(() => jest.clearAllMocks());

it("owner can open a source, see the full content, edit it, and delete it", async () => {
  const mock = proj("owner");
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);

  fireEvent.press(await screen.findByLabelText(/Input:/));
  fireEvent.press(screen.getByLabelText("Open source T"));
  expect(screen.getByText("full body")).toBeTruthy();

  fireEvent.press(screen.getByLabelText("Edit source"));
  fireEvent.changeText(screen.getByLabelText("Source content"), "edited body");
  fireEvent.press(screen.getByLabelText("Save source"));
  await waitFor(() => expect(mockEditInput).toHaveBeenCalledWith("i1", expect.objectContaining({ content: "edited body" })));

  fireEvent.press(screen.getByLabelText("Delete source"));
  await waitFor(() => expect(mockRemoveInput).toHaveBeenCalledWith("i1"));
});

it("title-only edit omits content from the PATCH body (so a cited source's title can be renamed without tripping the backend content-guard)", async () => {
  const mock = proj("owner");
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);

  fireEvent.press(await screen.findByLabelText(/Input:/));
  fireEvent.press(screen.getByLabelText("Open source T"));
  fireEvent.press(screen.getByLabelText("Edit source"));
  fireEvent.changeText(screen.getByLabelText("Source title"), "Renamed title");
  fireEvent.press(screen.getByLabelText("Save source"));

  await waitFor(() =>
    expect(mockEditInput).toHaveBeenCalledWith("i1", expect.objectContaining({ title: "Renamed title", content: undefined })),
  );
});

it("reviewer can open a source and see full content, but has no Edit/Delete controls", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(proj("reviewer"));
  render(<TrustProjectDetail />);

  fireEvent.press(await screen.findByLabelText(/Input:/));
  fireEvent.press(screen.getByLabelText("Open source T"));
  expect(screen.getByText("full body")).toBeTruthy();
  expect(screen.queryByLabelText("Edit source")).toBeNull();
  expect(screen.queryByLabelText("Delete source")).toBeNull();
});
