import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/constants/demo", () => ({ IS_DEMO: true }));
import { TourStep } from "@/onboarding/steps/TourStep";

const props = { stepIndex: 2, stepCount: 3, onDone: jest.fn(), onSkip: jest.fn() };
beforeEach(() => jest.clearAllMocks());

it("demo build: final page keeps Open my Library → /library", () => {
  render(<TourStep {...props} />);
  fireEvent.press(screen.getByText("Next"));            // page 0 → 1
  expect(screen.queryByText("Start a project")).toBeNull();
  fireEvent.press(screen.getByText("Open my Library"));
  expect(props.onDone).toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith("/library");
});
