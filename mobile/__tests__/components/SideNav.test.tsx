import React from "react";
import { StyleSheet } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";

// SideNav (like TopNavBar) reads useSafeAreaInsets. No test in this repo renders
// such a component outside expo-router's own SafeAreaProvider wrapper, so — unlike
// those — this one needs the library's own jest mock wired in explicitly, or the
// hook throws ("No safe area value available…") outside a <SafeAreaProvider>.
jest.mock("react-native-safe-area-context", () => {
  const mock = require("react-native-safe-area-context/jest/mock");
  return mock.default ?? mock;
});

import { SideNav } from "@/components/SideNav";

const navigate = jest.fn();
const emit = jest.fn(() => ({ defaultPrevented: false }));
function makeProps(activeIndex = 0) {
  const names = ["library", "shelves", "books", "projects", "reviews", "posts", "settings", "help", "about"];
  return {
    state: { index: activeIndex, routes: names.map((name, i) => ({ key: `${name}-${i}`, name })) },
    navigation: { navigate, emit },
  } as any;
}
beforeEach(() => jest.clearAllMocks());

it("renders a row for every non-demo destination", () => {
  render(<SideNav {...makeProps()} />);
  for (const label of ["Library", "Shelves", "Studio", "Projects", "Reviews", "Posts", "Settings", "Help", "About"]) {
    expect(screen.getByLabelText(label)).toBeTruthy();
  }
});

it("navigates on row tap", () => {
  render(<SideNav {...makeProps(0)} />);   // active = library
  fireEvent.press(screen.getByLabelText("Projects"));
  expect(navigate).toHaveBeenCalledWith("projects");
});

it("does not navigate when tapping the already-active row", () => {
  render(<SideNav {...makeProps(0)} />);   // library active
  fireEvent.press(screen.getByLabelText("Library"));
  expect(navigate).not.toHaveBeenCalled();
});

it("uses medium (500) weight on the row label, not the retired 600", () => {
  render(<SideNav {...makeProps(0)} />);
  const label = screen.getByText("Projects");
  expect(StyleSheet.flatten(label.props.style).fontWeight).toBe("500");
});
