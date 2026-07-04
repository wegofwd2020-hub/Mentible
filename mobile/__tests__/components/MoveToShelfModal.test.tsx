import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { MoveToShelfModal } from "@/components/MoveToShelfModal";
import type { Shelf } from "@/storage/shelfStore";

const shelves: Shelf[] = [
  { id: "s1", name: "Physics", createdAt: "", order: 0 },
  { id: "s2", name: "Chemistry", createdAt: "", order: 1 },
];

function renderModal(overrides = {}) {
  const props = {
    visible: true,
    shelves,
    currentShelfId: "s2" as string | null,
    onAssign: jest.fn(),
    onCreateShelf: jest.fn(),
    onClose: jest.fn(),
    ...overrides,
  };
  return { props, ...render(<MoveToShelfModal {...props} />) };
}

it("assigns the picked shelf", () => {
  const { props } = renderModal();
  fireEvent.press(screen.getByLabelText("Move to shelf: Physics"));
  expect(props.onAssign).toHaveBeenCalledWith("s1");
});

it("removes from shelf", () => {
  const { props } = renderModal();
  fireEvent.press(screen.getByLabelText("Remove from shelf"));
  expect(props.onAssign).toHaveBeenCalledWith(null);
});

it("triggers new-shelf creation", () => {
  const { props } = renderModal();
  fireEvent.press(screen.getByLabelText("New shelf"));
  expect(props.onCreateShelf).toHaveBeenCalled();
});
