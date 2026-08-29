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
  // The engine chip refreshes on focus; a no-op keeps render deterministic (the
  // engine label / token count stay at their initial blank/zero, which these
  // chrome tests don't assert on).
  useFocusEffect: () => {},
}));
// The always-on engine chip reads these; mock them so no real AsyncStorage is hit.
jest.mock("@/storage/settingsStore", () => ({
  loadDefaultParams: jest.fn().mockResolvedValue({ provider: "groq" }),
}));
jest.mock("@/storage/usageStore", () => ({
  listUsage: jest.fn().mockResolvedValue([]),
  summarizeUsage: () => ({ totalInputTokens: 0, totalOutputTokens: 0 }),
}));

// Most of this suite exercises app-mode chrome (existing tile rendering + the
// usage meter), unaffected by the marketing/app nav split — so `mockAuthStatus`
// defaults to signed_in (navModel → mode: "app"). The "auth-aware chrome"
// describe block below flips it to cover the marketing/loading branches at
// the render level (navState.test.tsx covers navModel() itself, unit-only).
let mockAuthStatus: string = "signed_in";
jest.mock("@/auth/AuthProvider", () => ({
  useAuth: () => ({ status: mockAuthStatus, session: null, signOut: jest.fn() }),
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

// Same shape as makeProps, but the route list also includes "index" (Home) —
// makeProps omits it because none of the app-mode tests below need it, but
// the loading-mode render (Home-only tile) does.
function makePropsWithIndex(activeIndex = 0) {
  const names = ["index", "library", "shelves", "books", "projects", "reviews", "posts", "settings", "help", "about"];
  return {
    state: { index: activeIndex, routes: names.map((name, i) => ({ key: `${name}-${i}`, name })) },
    navigation: { navigate: jest.fn(), emit: jest.fn(() => ({ defaultPrevented: false })) },
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStatus = null;
  mockAuthStatus = "signed_in";
});

describe("auth-aware chrome", () => {
  it("signed_out: renders marketing links + Sign in, not the app-only tabs", () => {
    mockAuthStatus = "signed_out";
    render(<TopNavBar {...makeProps(0)} />);
    expect(screen.getByLabelText("How it works")).toBeTruthy();
    expect(screen.getByLabelText("Formats")).toBeTruthy();
    expect(screen.getByLabelText("Sign in")).toBeTruthy();
    expect(screen.queryByLabelText("Library")).toBeNull();
  });

  it("loading: renders only Home — no flash of the app-tab set, no marketing, no Sign-in", () => {
    mockAuthStatus = "loading";
    render(<TopNavBar {...makePropsWithIndex(0)} />);
    expect(screen.getByLabelText("Home")).toBeTruthy();
    expect(screen.queryByLabelText("Library")).toBeNull();
    expect(screen.queryByLabelText("Projects")).toBeNull();
    expect(screen.queryByLabelText("How it works")).toBeNull();
    expect(screen.queryByLabelText("Sign in")).toBeNull();
  });
});

it("uses medium (500) weight on the tile label, not the retired 600", () => {
  render(<TopNavBar {...makeProps(0)} />);
  const label = screen.getByText("Projects");
  expect(StyleSheet.flatten(label.props.style).fontWeight).toBe("500");
});

describe("in-shell engine + usage chip", () => {
  it("shows the managed $ meter for an entitled managed status", () => {
    mockStatus = ENTITLED_STATUS;
    render(<TopNavBar {...makeProps(0)} />);
    expect(screen.getByLabelText(/open usage/)).toBeTruthy(); // the engine chip
    expect(screen.getByText(/Pro ·/)).toBeTruthy(); // managed allowance pill
  });

  it("shows the engine chip for a signed-in BYOK user (no managed plan)", () => {
    mockStatus = null; // signed_in (default) + no entitlement = BYOK app user
    render(<TopNavBar {...makeProps(0)} />);
    expect(screen.getByLabelText(/open usage/)).toBeTruthy();
    expect(screen.getByText(/tok$/)).toBeTruthy();
    expect(screen.getByText("Projects")).toBeTruthy(); // rest of chrome intact
  });

  it("hides the engine chip on the marketing (signed-out) home", () => {
    mockAuthStatus = "signed_out"; // marketing mode — a visitor, not a generating user
    mockStatus = null;
    render(<TopNavBar {...makeProps(0)} />);
    expect(screen.queryByLabelText(/open usage/)).toBeNull();
  });

  it("tapping the engine chip navigates to /usage", () => {
    mockStatus = ENTITLED_STATUS;
    render(<TopNavBar {...makeProps(0)} />);
    fireEvent.press(screen.getByLabelText(/open usage/));
    expect(mockPush).toHaveBeenCalledWith("/usage");
  });
});
