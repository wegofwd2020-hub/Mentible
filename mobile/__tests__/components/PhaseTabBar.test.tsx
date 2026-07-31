import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { PhaseTabBar } from "@/components/PhaseTabBar";
import { deriveProjectPhase } from "@/lib/projectPhase";

const input = { id: "i", kind: "note", title: null, content: "x", source_ref: null, created_at: null };
const detail = (over: any = {}) => ({ project: { id: "p", title: "P", topic: null }, my_role: "owner", artifacts: [], inputs: [], ...over }) as any;

it("renders a tab per phase with its content-noun label", () => {
  const phase = deriveProjectPhase(detail(), true);
  const { getByText } = render(<PhaseTabBar phase={phase} selected="capture" onSelect={() => {}} />);
  for (const label of ["Sources", "Drafts", "Feedback", "Publish"]) expect(getByText(label)).toBeTruthy();
});

it("marks the selected tab selected and reports taps", () => {
  const phase = deriveProjectPhase(detail({ inputs: [input] }), true);
  const onSelect = jest.fn();
  const { getByLabelText } = render(<PhaseTabBar phase={phase} selected="capture" onSelect={onSelect} />);
  // The selected Sources tab carries selected state.
  expect(getByLabelText(/Sources:/).props.accessibilityState.selected).toBe(true);
  // Tapping Drafts reports it.
  fireEvent.press(getByLabelText(/Drafts:/));
  expect(onSelect).toHaveBeenCalledWith("create");
});

it("shows done/current/upcoming state in the tab label", () => {
  const phase = deriveProjectPhase(detail({ inputs: [input] }), true); // capture done, create current
  const { getByLabelText } = render(<PhaseTabBar phase={phase} selected="create" onSelect={() => {}} />);
  expect(getByLabelText(/Sources: done/)).toBeTruthy();
  expect(getByLabelText(/Drafts: current/)).toBeTruthy();
  expect(getByLabelText(/Feedback: upcoming/)).toBeTruthy();
});
