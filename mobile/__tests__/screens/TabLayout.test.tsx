import React from "react";
import { render } from "@testing-library/react-native";
import { colors } from "@/constants/theme";

// Capture the screenOptions the Tabs navigator is configured with. The bottom-tab
// scene container has NO background of its own — without an explicit dark
// `sceneStyle`, each tab screen falls back to React Navigation's default scene
// background, which follows the DEVICE colour scheme (white on a light-mode
// device). Because the app palette is always dark (near-white `colors.text`),
// any tab screen that doesn't paint its own background then renders invisible
// text. This guards the fix: the navigator paints the dark app background so
// every tab screen is legible regardless of the device scheme.
let capturedScreenOptions: Record<string, unknown> | undefined;

jest.mock("expo-router", () => {
  const React2 = require("react");
  const Tabs = ({ screenOptions, children }: { screenOptions?: Record<string, unknown>; children?: React.ReactNode }) => {
    capturedScreenOptions = screenOptions;
    return React2.createElement(React2.Fragment, null, children);
  };
  Tabs.Screen = () => null;
  return { Tabs };
});
jest.mock("@/components/TopNavBar", () => ({ TopNavBar: () => null }));

import TabLayout from "@/../app/(tabs)/_layout";

beforeEach(() => {
  capturedScreenOptions = undefined;
});

it("paints the dark app background on the tab scene container", () => {
  render(<TabLayout />);
  const sceneStyle = capturedScreenOptions?.["sceneStyle"] as { backgroundColor?: string } | undefined;
  expect(sceneStyle?.backgroundColor).toBe(colors.background);
});
