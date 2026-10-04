import React from "react";
import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";
import ReviewsScreen from "@/../app/(tabs)/reviews";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    const R = require("react");
    R.useEffect(() => cb(), [cb]);
  },
}));
jest.mock("@/auth/RequireSignIn", () => ({ RequireSignIn: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "test-token", status: "signed_in" }) }));
jest.mock("@/hooks/useReviews", () => ({ useReviews: jest.fn() }));
jest.mock("@/api/trustClient", () => ({ approveVersion: jest.fn(), withdrawApproval: jest.fn() }));
import { useReviews } from "@/hooks/useReviews";

beforeEach(() => jest.clearAllMocks());

// Asserts a rendered <Text> node never carries the retired bold (700) weight —
// the Studio primitives (Card/Label) top out at 500.
function expectNotBold(text: ReturnType<typeof screen.getByText>) {
  expect(StyleSheet.flatten(text.props.style).fontWeight).not.toBe("700");
}

it("titles review rows in Fraunces and carries no bold (700) weight on the migrated Studio controls", async () => {
  (useReviews as jest.Mock).mockReturnValue({
    reviews: [{
      projectId: "p1",
      title: "Stormwater",
      versionsTotal: 2,
      versionsValidated: 1,
      detail: {} as any,
      versions: [
        { id: "v1", version_no: 1, created_at: new Date().toISOString(), is_validated: false, artifactTitle: "Lesson", artifactFormat: "lesson" },
        { id: "v2", version_no: 2, created_at: new Date().toISOString(), is_validated: true, artifactTitle: "Lesson", artifactFormat: "lesson" },
      ],
    }],
    loading: false,
    error: null,
    refresh: jest.fn(),
  });
  render(<ReviewsScreen />);

  // (a) row heading face: Fraunces, not the retired Playfair.
  const title = await screen.findByText("Stormwater");
  expect(StyleSheet.flatten(title.props.style).fontFamily).toMatch(/Fraunces/);
  expectNotBold(title);

  // (b) no migrated control carries fontWeight: "700".
  expectNotBold(screen.getByText("1/2 versions validated"));
});

it("titles the empty state in Fraunces", () => {
  (useReviews as jest.Mock).mockReturnValue({ reviews: [], loading: false, error: null, refresh: jest.fn() });
  render(<ReviewsScreen />);
  const empty = screen.getByText(/no projects to/i);
  expect(StyleSheet.flatten(empty.props.style).fontFamily).toMatch(/Fraunces/);
});
