import React from "react";
import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";

// TopNavBar (like SideNav) reads useSafeAreaInsets. No test in this repo
// renders such a component outside expo-router's own SafeAreaProvider
// wrapper, so it needs the library's own jest mock wired in explicitly, or
// the hook throws ("No safe area value available…") outside a
// <SafeAreaProvider>.
jest.mock("react-native-safe-area-context", () => {
  const mock = require("react-native-safe-area-context/jest/mock");
  return mock.default ?? mock;
});

import { TopNavBar } from "@/components/TopNavBar";

function makeProps(activeIndex = 0) {
  const names = ["library", "shelves", "books", "projects", "reviews", "posts", "settings", "help", "about"];
  return {
    state: { index: activeIndex, routes: names.map((name, i) => ({ key: `${name}-${i}`, name })) },
    navigation: { navigate: jest.fn(), emit: jest.fn(() => ({ defaultPrevented: false })) },
  } as any;
}

it("uses medium (500) weight on the tile label, not the retired 600", () => {
  render(<TopNavBar {...makeProps(0)} />);
  const label = screen.getByText("Projects");
  expect(StyleSheet.flatten(label.props.style).fontWeight).toBe("500");
});
