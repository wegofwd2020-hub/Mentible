import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { PhaseNav } from "@/components/PhaseNav";

it("first phase (capture) shows Next only, no Back", () => {
  const onSelect = jest.fn();
  const { getByLabelText, queryByLabelText } = render(
    <PhaseNav phaseKey="capture" onSelect={onSelect} />,
  );
  expect(getByLabelText("Next to Structure")).toBeTruthy();
  expect(queryByLabelText(/^Back to/)).toBeNull();
  fireEvent.press(getByLabelText("Next to Structure"));
  expect(onSelect).toHaveBeenCalledWith("structure");
});

it("last phase (share) shows Back only, no Next", () => {
  const onSelect = jest.fn();
  const { getByLabelText, queryByLabelText } = render(
    <PhaseNav phaseKey="share" onSelect={onSelect} />,
  );
  expect(getByLabelText("Back to Feedback")).toBeTruthy();
  expect(queryByLabelText(/^Next to/)).toBeNull();
  fireEvent.press(getByLabelText("Back to Feedback"));
  expect(onSelect).toHaveBeenCalledWith("validate");
});

it("a middle phase (create) has both Back and Next to the right neighbours", () => {
  const onSelect = jest.fn();
  const { getByLabelText } = render(<PhaseNav phaseKey="create" onSelect={onSelect} />);
  fireEvent.press(getByLabelText("Back to Structure"));
  expect(onSelect).toHaveBeenCalledWith("structure");
  fireEvent.press(getByLabelText("Next to Feedback"));
  expect(onSelect).toHaveBeenCalledWith("validate");
});
