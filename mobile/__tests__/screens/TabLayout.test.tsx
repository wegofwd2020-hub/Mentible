import React from "react";
import { render } from "@testing-library/react-native";
import { themes } from "@/constants/theme";

// Capture the screenOptions the Tabs navigator is configured with. The bottom-tab
// scene container has NO background of its own — without an explicit dark
// `sceneStyle`, each tab screen falls back to React Navigation's default scene
// background, which follows the DEVICE colour scheme (white on a light-mode
// device). Because the app palette is always dark (near-white `colors.text`),
// any tab screen that doesn't paint its own background then renders invisible
// text. This guards the fix: the navigator paints the dark app background so
// every tab screen is legible regardless of the device scheme.
let capturedScreenOptions: Record<string, unknown> | undefined;
let capturedTabBar: ((props: unknown) => unknown) | undefined;

jest.mock("expo-router", () => {
  const React2 = require("react");
  function Tabs({
    screenOptions,
    tabBar,
    children,
  }: {
    screenOptions?: Record<string, unknown>;
    tabBar?: (props: unknown) => unknown;
    children?: React.ReactNode;
  }) {
    capturedScreenOptions = screenOptions;
    capturedTabBar = tabBar;
    return React2.createElement(React2.Fragment, null, children);
  }
  function TabsScreen() {
    return null;
  }
  Tabs.Screen = TabsScreen;
  return { Tabs };
});
jest.mock("@/components/TopNavBar", () => ({
  TopNavBar: function TopNavBar() {
    return null;
  },
}));
jest.mock("@/components/SideNav", () => ({
  SideNav: function SideNav() {
    return null;
  },
}));
jest.mock("@/hooks/useResponsive", () => ({ useResponsive: jest.fn() }));

import TabLayout from "@/../app/(tabs)/_layout";
import { useResponsive } from "@/hooks/useResponsive";
import { SideNav } from "@/components/SideNav";
import { TopNavBar } from "@/components/TopNavBar";

beforeEach(() => {
  capturedScreenOptions = undefined;
  capturedTabBar = undefined;
  (useResponsive as jest.Mock).mockReturnValue({ width: 500, isTablet: false, isDesktop: false });
});

it("paints the dark app background on the tab scene container", () => {
  render(<TabLayout />);
  const sceneStyle = capturedScreenOptions?.["sceneStyle"] as { backgroundColor?: string } | undefined;
  expect(sceneStyle?.backgroundColor).toBe(themes["studio-dark"].background);
});

it("uses a left SideNav on desktop widths", () => {
  (useResponsive as jest.Mock).mockReturnValue({ width: 1300, isTablet: true, isDesktop: true });
  render(<TabLayout />);
  expect(capturedScreenOptions?.tabBarPosition).toBe("left");
  expect((capturedTabBar!({} as any) as any).type).toBe(SideNav);
});

it("uses the top TopNavBar on narrow widths", () => {
  (useResponsive as jest.Mock).mockReturnValue({ width: 500, isTablet: false, isDesktop: false });
  render(<TabLayout />);
  expect(capturedScreenOptions?.tabBarPosition).toBe("top");
  expect((capturedTabBar!({} as any) as any).type).toBe(TopNavBar);
});
