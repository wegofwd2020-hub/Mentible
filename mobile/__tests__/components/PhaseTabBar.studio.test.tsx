import React from "react";
import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { PhaseTabBar } from "@/components/PhaseTabBar";
import { deriveProjectPhase } from "@/lib/projectPhase";
import { themes } from "@/constants/theme";

const t = themes["navy-trust"];

const input = { id: "i", kind: "note", title: null, content: "x", source_ref: null, created_at: null };
const detail = (over: any = {}) => ({ project: { id: "p", title: "P", topic: null }, my_role: "owner", artifacts: [], inputs: [], ...over }) as any;

it("styles the active tab with a primary underline and text label, not a filled pill", () => {
  const phase = deriveProjectPhase(detail({ inputs: [input] }), true);
  render(<PhaseTabBar phase={phase} selected="capture" onSelect={() => {}} />);

  const activeTab = screen.getByLabelText(/Input:/);
  const activeTabFlat = StyleSheet.flatten(activeTab.props.style);
  // Underline treatment: a bottom border in the primary color, 1.5px thick —
  // never a filled backgroundColor (that was the old pill look).
  expect(activeTabFlat.backgroundColor).toBeUndefined();
  expect(activeTabFlat.borderBottomColor).toBe(t.primary);
  expect(activeTabFlat.borderBottomWidth).toBe(1.5);

  const activeLabel = screen.getByText("Input");
  const activeLabelFlat = StyleSheet.flatten(activeLabel.props.style);
  expect(activeLabelFlat.color).toBe(t.text);

  const inactiveTab = screen.getByLabelText(/Drafts:/);
  const inactiveTabFlat = StyleSheet.flatten(inactiveTab.props.style);
  expect(inactiveTabFlat.backgroundColor).toBeUndefined();

  const inactiveLabel = screen.getByText("Drafts");
  const inactiveLabelFlat = StyleSheet.flatten(inactiveLabel.props.style);
  expect(inactiveLabelFlat.color).toBe(t.textMuted);
});
