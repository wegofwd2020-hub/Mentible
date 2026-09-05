import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ projectId: "p1" }),
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
  useFocusEffect: (cb: () => void) => cb(),
}));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: null, loading: false }) }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));
import { useTrustProject } from "@/hooks/useTrustProject";

function projectWithTranscript(my_role = "owner") {
  return {
    project: {
      project: { id: "p1", title: "P", topic: null },
      my_role,
      inputs: [],
      artifacts: [
        {
          artifact: { id: "tart", title: "recipe.mp3", role: "cornerstone", format: "transcript" },
          versions: [{ id: "tv1", version_no: 1, is_validated: false, recorded_via: null }],
        },
      ],
    },
    loading: false,
    error: null,
    refresh: jest.fn(),
    inputs: [],
    editInput: jest.fn(),
    removeInput: jest.fn(),
    transcribeAudio: jest.fn(),
  };
}

beforeEach(() => jest.clearAllMocks());

it("owner sees a Transcripts row on Input and tapping opens the transcript review screen", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(projectWithTranscript("owner"));
  render(<TrustProjectDetail />);
  // Input (capture) is the default phase for a project with no drafts.
  const row = await screen.findByLabelText("Open transcript recipe.mp3");
  expect(screen.getByText("recipe.mp3")).toBeTruthy();
  fireEvent.press(row);
  expect(mockPush).toHaveBeenCalledWith(
    expect.objectContaining({
      pathname: "/trust/transcript/[artifactId]",
      params: expect.objectContaining({ artifactId: "tart", versionId: "tv1", projectId: "p1" }),
    }),
  );
});
