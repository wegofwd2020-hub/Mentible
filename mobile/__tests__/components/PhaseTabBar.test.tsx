import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { PhaseTabBar } from "@/components/PhaseTabBar";
import { deriveProjectPhase } from "@/lib/projectPhase";

const input = { id: "i", kind: "note", title: null, content: "x", source_ref: null, created_at: null };
const detail = (over: any = {}) => ({ project: { id: "p", title: "P", topic: null }, my_role: "owner", artifacts: [], inputs: [], ...over }) as any;

it("renders a tab per phase with its content-noun label", () => {
  const phase = deriveProjectPhase(detail(), true);
  const { getByText } = render(<PhaseTabBar phase={phase} selected="capture" onSelect={() => {}} />);
  for (const label of ["Input", "Drafts", "Feedback", "Publish"]) expect(getByText(label)).toBeTruthy();
});

it("marks the selected tab selected and reports taps", () => {
  const phase = deriveProjectPhase(detail({ inputs: [input] }), true);
  const onSelect = jest.fn();
  const { getByLabelText } = render(<PhaseTabBar phase={phase} selected="capture" onSelect={onSelect} />);
  // The selected Input tab carries selected state.
  expect(getByLabelText(/Input:/).props.accessibilityState.selected).toBe(true);
  // Tapping Drafts reports it.
  fireEvent.press(getByLabelText(/Drafts:/));
  expect(onSelect).toHaveBeenCalledWith("create");
});

it("shows done/current/upcoming state in the tab label", () => {
  // capture done (has inputs); structure not skip-satisfied (no toc, no
  // version yet) → structure current; create/validate/share upcoming.
  const phase = deriveProjectPhase(detail({ inputs: [input] }), true);
  const { getByLabelText } = render(<PhaseTabBar phase={phase} selected="structure" onSelect={() => {}} />);
  expect(getByLabelText(/Input: done/)).toBeTruthy();
  expect(getByLabelText(/Structure: current/)).toBeTruthy();
  expect(getByLabelText(/Drafts: upcoming/)).toBeTruthy();
});
