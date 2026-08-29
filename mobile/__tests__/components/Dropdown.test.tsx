import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Dropdown } from "@/components/Dropdown";

const OPTIONS = [
  { value: "anthropic", label: "Anthropic (Claude)", description: "Authoring-grade" },
  { value: "groq", label: "Groq (free)", description: "Experimental" },
];

it("shows the selected option's label on the trigger", () => {
  render(<Dropdown value="anthropic" options={OPTIONS} onChange={() => {}} />);
  expect(screen.getByText("Anthropic (Claude)")).toBeTruthy();
});

it("opens the list on press and selecting an option calls onChange with its value", () => {
  const onChange = jest.fn();
  render(<Dropdown value="anthropic" options={OPTIONS} onChange={onChange} />);
  // The other option isn't visible until the list opens.
  expect(screen.queryByText("Groq (free)")).toBeNull();
  fireEvent.press(screen.getByLabelText("Open selection"));
  fireEvent.press(screen.getByLabelText("Groq (free)"));
  expect(onChange).toHaveBeenCalledWith("groq");
});

it("uses a custom accessibility label on the trigger", () => {
  render(
    <Dropdown
      value="groq"
      options={OPTIONS}
      onChange={() => {}}
      accessibilityLabel="Generation engine"
    />,
  );
  expect(screen.getByLabelText("Generation engine")).toBeTruthy();
});
