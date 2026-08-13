import React from "react";
import { StyleSheet } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";

// TopNavBar (like SideNav) reads useSafeAreaInsets. No test in this repo
// renders such a component outside expo-router's own SafeAreaProvider
// wrapper, so it needs the library's own jest mock wired in explicitly, or
// the hook throws ("No safe area value available…") outside a
// <SafeAreaProvider>.
jest.mock("react-native-safe-area-context", () => {
  const mock = require("react-native-safe-area-context/jest/mock");
  return mock.default ?? mock;
});

// Self-contained mocks (jest hoists these above imports) for the in-shell
// usage meter (ChromeUsageMeter, wired via TopNavBar). `mockStatus` lets
// each test flip between an entitled managed status and null (BYOK/anon/
// signed-out — the common case where the chrome must look unchanged).
let mockStatus: unknown = null;
jest.mock("@/hooks/useManagedStatus", () => ({
  useManagedStatus: () => ({ status: mockStatus, loading: false }),
}));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { TopNavBar } from "@/components/TopNavBar";

const ENTITLED_STATUS = {
  entitlement: {
    plan_id: "pro",
    plan_display: "Pro",
    status: "active" as const,
    period_start: "2026-08-01",
    period_end: "2026-09-01",
  },
  usage: { cost_micros: 1_000_000, input_tokens: 100, output_tokens: 50, events: 3 },
  allowance_micros: 5_000_000,
  window_start: "2026-08-01",
};

function makeProps(activeIndex = 0) {
  const names = ["library", "shelves", "books", "projects", "reviews", "posts", "settings", "help", "about"];
  return {
    state: { index: activeIndex, routes: names.map((name, i) => ({ key: `${name}-${i}`, name })) },
    navigation: { navigate: jest.fn(), emit: jest.fn(() => ({ defaultPrevented: false })) },
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStatus = null;
});

it("uses medium (500) weight on the tile label, not the retired 600", () => {
  render(<TopNavBar {...makeProps(0)} />);
  const label = screen.getByText("Projects");
  expect(StyleSheet.flatten(label.props.style).fontWeight).toBe("500");
});

describe("in-shell usage meter", () => {
  it("shows the usage meter pill for an entitled managed status", () => {
    mockStatus = ENTITLED_STATUS;
    render(<TopNavBar {...makeProps(0)} />);
    expect(screen.getByLabelText("Usage — open details")).toBeTruthy();
    expect(screen.getByText(/Pro ·/)).toBeTruthy();
  });

  it("shows no meter when status is null (BYOK/anonymous chrome unchanged)", () => {
    mockStatus = null;
    render(<TopNavBar {...makeProps(0)} />);
    expect(screen.queryByLabelText("Usage — open details")).toBeNull();
    // The rest of the chrome still renders normally.
    expect(screen.getByText("Projects")).toBeTruthy();
  });

  it("tapping the meter navigates to /usage", () => {
    mockStatus = ENTITLED_STATUS;
    render(<TopNavBar {...makeProps(0)} />);
    fireEvent.press(screen.getByLabelText("Usage — open details"));
    expect(mockPush).toHaveBeenCalledWith("/usage");
  });
});
