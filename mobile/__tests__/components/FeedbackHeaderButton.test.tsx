import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { FeedbackHeaderButton } from "@/components/FeedbackHeaderButton";

let mockStatus = "signed_in";
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ status: mockStatus }) }));
jest.mock("@/constants/demo", () => ({ IS_DEMO: false }));
// The sheet is exercised in its own test; here we only care about the button
// gating + that tapping it toggles the sheet open (visible prop).
jest.mock("@/components/FeedbackSheet", () => ({
  FeedbackSheet: ({ visible }: { visible: boolean }) => {
    const { Text } = require("react-native");
    return visible ? <Text>sheet-open</Text> : null;
  },
}));

beforeEach(() => {
  mockStatus = "signed_in";
});

it("renders the feedback button when signed in", () => {
  render(<FeedbackHeaderButton />);
  expect(screen.getByLabelText("Send feedback")).toBeTruthy();
});

it("renders nothing when signed out", () => {
  mockStatus = "signed_out";
  render(<FeedbackHeaderButton />);
  expect(screen.queryByLabelText("Send feedback")).toBeNull();
});

it("opens the feedback sheet when tapped", () => {
  render(<FeedbackHeaderButton />);
  expect(screen.queryByText("sheet-open")).toBeNull();
  fireEvent.press(screen.getByLabelText("Send feedback"));
  expect(screen.getByText("sheet-open")).toBeTruthy();
});
