import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/constants/demo", () => ({ IS_DEMO: false }));
import { TourStep } from "@/onboarding/steps/TourStep";

const props = { stepIndex: 2, stepCount: 3, onDone: jest.fn(), onSkip: jest.fn() };
beforeEach(() => jest.clearAllMocks());

it("real build: final page offers Start a project → /trust/new", () => {
  render(<TourStep {...props} />);
  fireEvent.press(screen.getByText("Next"));            // page 0 → 1
  fireEvent.press(screen.getByText("Start a project"));
  expect(props.onDone).toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith("/trust/new");
});
