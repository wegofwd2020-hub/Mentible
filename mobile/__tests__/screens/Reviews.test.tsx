import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import ReviewsScreen from "@/../app/(tabs)/reviews";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }), useFocusEffect: (cb: () => void) => { const R = require("react"); R.useEffect(() => cb(), [cb]); } }));
jest.mock("@/auth/RequireSignIn", () => ({ RequireSignIn: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.mock("@/hooks/useReviews", () => ({ useReviews: jest.fn() }));
import { useReviews } from "@/hooks/useReviews";

beforeEach(() => { jest.clearAllMocks(); });

it("lists review projects and navigates on tap", async () => {
  (useReviews as jest.Mock).mockReturnValue({
    reviews: [{ projectId: "p1", title: "Stormwater", versionsTotal: 2, versionsValidated: 1 }],
    loading: false, error: null, refresh: jest.fn(),
  });
  render(<ReviewsScreen />);
  fireEvent.press(await screen.findByLabelText("Open project: Stormwater"));
  expect(mockPush).toHaveBeenCalledWith("/trust/p1");
});

it("shows an empty state when there are no reviews", () => {
  (useReviews as jest.Mock).mockReturnValue({ reviews: [], loading: false, error: null, refresh: jest.fn() });
  render(<ReviewsScreen />);
  expect(screen.getByText(/no projects to review/i)).toBeTruthy();
});
