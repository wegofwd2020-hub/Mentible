import { render, fireEvent } from "@testing-library/react-native";
import { DiscoveryNudge } from "../DiscoveryNudge";

it("renders the text and fires onDismiss when × pressed", () => {
  const onDismiss = jest.fn();
  const { getByText, getByLabelText } = render(
    <DiscoveryNudge text="Make a quiz" onDismiss={onDismiss} testID="nudge-x" />,
  );
  expect(getByText("Make a quiz")).toBeTruthy();
  fireEvent.press(getByLabelText("Dismiss hint"));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});
