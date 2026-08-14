import React from "react";
import { render } from "@testing-library/react-native";

// Capture the screenOptions the Tabs navigator is configured with. The bottom-tab
// scene container's `sceneStyle` is TRANSPARENT (Slice B, lovable-background) so
// the root `AppBackground` gradient — mounted above the Stack in `app/_layout.tsx`,
// which every tab screen sits inside — shows through instead of a flat theme fill.
// This guards that: the navigator no longer paints an opaque background of its own.
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

it("leaves the tab scene container transparent so the root gradient shows through", () => {
  render(<TabLayout />);
  const sceneStyle = capturedScreenOptions?.["sceneStyle"] as { backgroundColor?: string } | undefined;
  expect(sceneStyle?.backgroundColor).toBe("transparent");
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
