import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ShelfNameModal } from "@/components/ShelfNameModal";

it("submits the trimmed name and does not submit when empty", () => {
  const onSubmit = jest.fn();
  const onClose = jest.fn();
  render(<ShelfNameModal visible title="New shelf" onSubmit={onSubmit} onClose={onClose} />);

  // Empty → Save is a no-op.
  fireEvent.press(screen.getByLabelText("Save shelf name"));
  expect(onSubmit).not.toHaveBeenCalled();

  fireEvent.changeText(screen.getByLabelText("Shelf name"), "  Physics  ");
  fireEvent.press(screen.getByLabelText("Save shelf name"));
  expect(onSubmit).toHaveBeenCalledWith("Physics");
});

it("prefills initialName for rename", () => {
  render(<ShelfNameModal visible title="Rename shelf" initialName="Chem" onSubmit={jest.fn()} onClose={jest.fn()} />);
  expect(screen.getByDisplayValue("Chem")).toBeTruthy();
});
