import React from "react";
import { render, screen } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ projectId: "p1" }),
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
  // Model the real expo-router behavior of "run this callback whenever the
  // screen gains focus" by invoking it immediately, so RNTL exercises it
  // without needing a real navigation container.
  useFocusEffect: (cb: () => void) => cb(),
}));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
import { useTrustProject } from "@/hooks/useTrustProject";

const mockRefresh = jest.fn();

const base = {
  project: {
    project: { id: "p1", title: "Stormwater", topic: null },
    my_role: "reviewer",
    artifacts: [
      {
        artifact: { id: "art", title: "Guide", role: "cornerstone", format: "book" },
        versions: [{ id: "v1", version_no: 1, is_validated: true, recorded_via: "expert_self" }],
      },
    ],
  },
  loading: false,
  error: null,
  refresh: mockRefresh,
};

beforeEach(() => {
  jest.clearAllMocks();
});

it("refetches the project when the screen regains focus", async () => {
  // Root cause: approving/unapproving happens on a separate screen (the draft
  // viewer). Without a focus-triggered refetch here, navigating back shows
  // stale project data (e.g. a just-approved version missing from Publish)
  // until a full reload. This asserts the fix wires useFocusEffect to refresh().
  (useTrustProject as jest.Mock).mockReturnValue({ ...base });
  render(<TrustProjectDetail />);
  expect(await screen.findByText("Stormwater")).toBeTruthy();
  expect(mockRefresh).toHaveBeenCalled();
});
