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

// Self-contained mocks for the in-shell usage meter (ChromeUsageMeter, wired
// via SideNav). `mockStatus` flips between an entitled managed status and
// null (BYOK/anon/signed-out — the common case where the chrome must look
// unchanged).
let mockStatus: unknown = null;
jest.mock("@/hooks/useManagedStatus", () => ({
  useManagedStatus: () => ({ status: mockStatus, loading: false }),
}));
const mockUsagePush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockUsagePush }),
}));

// Most of this suite exercises app-mode chrome (existing row rendering + the
// usage meter), unaffected by the marketing/app nav split — so `mockAuthStatus`
// defaults to signed_in (navModel → mode: "app"). The "auth-aware chrome"
// describe block below flips it to cover the marketing/loading branches at
// the render level (navState.test.tsx covers navModel() itself, unit-only).
let mockAuthStatus: string = "signed_in";
jest.mock("@/auth/AuthProvider", () => ({
  useAuth: () => ({ status: mockAuthStatus, session: null, signOut: jest.fn() }),
}));

import { SideNav } from "@/components/SideNav";

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

const navigate = jest.fn();
const emit = jest.fn(() => ({ defaultPrevented: false }));
function makeProps(activeIndex = 0) {
  const names = ["library", "shelves", "books", "projects", "reviews", "posts", "settings", "help", "about"];
  return {
    state: { index: activeIndex, routes: names.map((name, i) => ({ key: `${name}-${i}`, name })) },
    navigation: { navigate, emit },
  } as any;
}
function makePropsWithIndex(activeIndex = 0) {
  const names = ["index", "library", "shelves", "books", "projects", "reviews", "posts", "settings", "help", "about"];
  return {
    state: { index: activeIndex, routes: names.map((name, i) => ({ key: `${name}-${i}`, name })) },
    navigation: { navigate, emit },
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
    render(<SideNav {...makeProps(0)} />);
    expect(screen.getByLabelText("How it works")).toBeTruthy();
    expect(screen.getByLabelText("Formats")).toBeTruthy();
    expect(screen.getByLabelText("Sign in")).toBeTruthy();
    expect(screen.queryByLabelText("Library")).toBeNull();
  });

  it("loading: renders only Home — no flash of the app-tab set, no marketing, no Sign-in", () => {
    mockAuthStatus = "loading";
    render(<SideNav {...makePropsWithIndex(0)} />);
    expect(screen.getByLabelText("Home")).toBeTruthy();
    expect(screen.queryByLabelText("Library")).toBeNull();
    expect(screen.queryByLabelText("Projects")).toBeNull();
    expect(screen.queryByLabelText("How it works")).toBeNull();
    expect(screen.queryByLabelText("Sign in")).toBeNull();
  });
});

it("renders a row for every non-demo destination", () => {
  render(<SideNav {...makeProps()} />);
  for (const label of ["Library", "Studio", "Projects", "Reviews", "Settings", "Help", "About"]) {
    expect(screen.getByLabelText(label)).toBeTruthy();
  }
});

it("hides Shelves from the nav (Posts shows as 'Publish', not 'Posts')", () => {
  render(<SideNav {...makeProps()} />);
  for (const label of ["Shelves", "Posts"]) {
    expect(screen.queryByLabelText(label)).toBeNull();
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

describe("in-shell usage meter", () => {
  it("shows the usage meter pill for an entitled managed status", () => {
    mockStatus = ENTITLED_STATUS;
    render(<SideNav {...makeProps(0)} />);
    expect(screen.getByLabelText("Usage — open details")).toBeTruthy();
    expect(screen.getByText(/Pro ·/)).toBeTruthy();
  });

  it("shows no meter when status is null (BYOK/anonymous chrome unchanged)", () => {
    mockStatus = null;
    render(<SideNav {...makeProps(0)} />);
    expect(screen.queryByLabelText("Usage — open details")).toBeNull();
    // The rest of the chrome still renders normally.
    expect(screen.getByLabelText("Projects")).toBeTruthy();
  });

  it("tapping the meter navigates to /usage", () => {
    mockStatus = ENTITLED_STATUS;
    render(<SideNav {...makeProps(0)} />);
    fireEvent.press(screen.getByLabelText("Usage — open details"));
    expect(mockUsagePush).toHaveBeenCalledWith("/usage");
  });
});
