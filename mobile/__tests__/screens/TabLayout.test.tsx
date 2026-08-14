import React from "react";
import { render } from "@testing-library/react-native";

// Capture the screenOptions the Tabs navigator is configured with. The bottom-tab
// scene container's `sceneStyle` MUST be OPAQUE (the theme background). On web,
// react-native-screens is inactive, so bottom-tabs can't detach inactive tab
// scenes — every scene stays mounted, stacked, and visible; only the active
// scene's opaque fill hides the ones beneath it. A brief TRANSPARENT sceneStyle
// (Slice B, lovable-background) removed that cover and made Shelves/Library/
// Projects render on top of each other. This guards that the scene fill stays
// opaque so that can't regress.
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

it("paints an OPAQUE tab scene fill so inactive tabs can't bleed through on web", () => {
  render(<TabLayout />);
  const sceneStyle = capturedScreenOptions?.["sceneStyle"] as { backgroundColor?: string } | undefined;
  const bg = sceneStyle?.backgroundColor;
  // Must be an opaque colour (a hex from the theme), never "transparent" — that
  // was the regression that let stacked tab scenes show through each other.
  expect(bg).toBeDefined();
  expect(bg).not.toBe("transparent");
  expect(bg).toMatch(/^#[0-9a-fA-F]{6}$/);
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
