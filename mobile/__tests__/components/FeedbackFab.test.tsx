import React from "react";
import { render, screen } from "@testing-library/react-native";
import { FeedbackFab } from "@/components/FeedbackFab";

let mockStatus = "signed_in";
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ status: mockStatus }) }));
jest.mock("@/constants/demo", () => ({ IS_DEMO: false }));
jest.mock("@/components/FeedbackSheet", () => ({ FeedbackSheet: () => null }));

it("shows the Feedback button when signed in", () => {
  mockStatus = "signed_in";
  render(<FeedbackFab />);
  expect(screen.getByLabelText("Send feedback")).toBeTruthy();
});

it("renders nothing when signed out", () => {
  mockStatus = "signed_out";
  const { toJSON } = render(<FeedbackFab />);
  expect(toJSON()).toBeNull();
});
