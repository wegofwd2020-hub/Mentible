import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { FeedbackBadge } from "@/components/FeedbackBadge";

it("renders nothing when count is 0", () => {
  expect(render(<FeedbackBadge count={0} onPress={jest.fn()} />).toJSON()).toBeNull();
});

it("shows the count and fires onPress without bubbling", () => {
  const onPress = jest.fn();
  render(<FeedbackBadge count={3} onPress={onPress} />);
  expect(screen.getByText("3")).toBeTruthy();
  fireEvent.press(screen.getByLabelText("Feedback: 3 comments"));
  expect(onPress).toHaveBeenCalled();
});

it("accepts a style prop and still renders the count and fires onPress", () => {
  const onPress = jest.fn();
  render(<FeedbackBadge count={2} onPress={onPress} style={{ position: "absolute", top: 6, left: 6 }} />);
  expect(screen.getByText("2")).toBeTruthy();
  fireEvent.press(screen.getByLabelText("Feedback: 2 comments"));
  expect(onPress).toHaveBeenCalled();
});
