import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { FRAUNCES } from "@/constants/fonts";

const mockUseLocalSearchParams = jest.fn(() => ({} as { topic?: string }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

import HelpScreen from "../../app/(tabs)/help";

// Flattens an RN style (object | array | nested array) into a single object so
// tests can inspect the resolved fontFamily/fontWeight without caring how many
// style arrays a primitive wraps things in.
function flattenStyle(style: unknown): Record<string, unknown> {
  const arr = Array.isArray(style) ? style.flat(Infinity) : [style];
  return Object.assign({}, ...arr.filter(Boolean));
}

describe("HelpScreen", () => {
  beforeEach(() => {
    mockUseLocalSearchParams.mockReturnValue({});
  });

  it("renders the Help title in Fraunces with no bold (700/600) weight — Studio re-skin", () => {
    render(<HelpScreen />);
    const style = flattenStyle(screen.getByText("Help").props.style);
    expect(style["fontFamily"]).toBe(FRAUNCES.semibold);
    expect(style["fontWeight"]).not.toBe("700");
    expect(style["fontWeight"]).not.toBe("600");
  });

  it("renders search-result topic titles via the Label primitive (uppercase, never bold)", () => {
    render(<HelpScreen />);
    fireEvent.changeText(screen.getByLabelText("Search help"), "billing");
    const style = flattenStyle(screen.getByText("Plans & billing").props.style);
    expect(style["textTransform"]).toBe("uppercase");
    expect(style["fontWeight"]).not.toBe("700");
    expect(style["fontWeight"]).not.toBe("600");
  });

  it("renders the tree collapsed by default — no topic body visible until expanded", () => {
    render(<HelpScreen />);
    expect(screen.getByText("Getting started")).toBeTruthy(); // top-level branch row
    expect(screen.queryByText(/Mentible turns what you want to learn/)).toBeNull();
  });

  it("expands a branch on tap to reveal its leaves, and collapses again on a second tap", () => {
    render(<HelpScreen />);
    const branch = screen.getByTestId("help-branch-getting-started");
    fireEvent.press(branch);
    expect(screen.getByText("Welcome & setup steps")).toBeTruthy();
    fireEvent.press(branch);
    expect(screen.queryByText("Welcome & setup steps")).toBeNull();
  });

  it("expands a leaf on tap to reveal its topic content", () => {
    render(<HelpScreen />);
    fireEvent.press(screen.getByTestId("help-branch-getting-started"));
    fireEvent.press(screen.getByTestId("help-leaf-leaf-welcome"));
    expect(screen.getByText(/Mentible turns what you want to learn/)).toBeTruthy();
  });

  it("search filters to matching topics without needing the tree expanded", () => {
    render(<HelpScreen />);
    fireEvent.changeText(screen.getByLabelText("Search help"), "byok");
    expect(screen.getByText(/Bring Your Own Key/)).toBeTruthy();
  });

  it("clearing the search query returns the tree to its collapsed default", () => {
    render(<HelpScreen />);
    const input = screen.getByLabelText("Search help");
    fireEvent.changeText(input, "byok");
    expect(screen.getByText(/Bring Your Own Key/)).toBeTruthy();

    fireEvent.changeText(input, "");
    // Back to the collapsed tree: a top-level branch row is visible again...
    expect(screen.getByText("Getting started")).toBeTruthy();
    // ...and the search-only result (never expanded in the tree) is gone.
    expect(screen.queryByText(/Bring Your Own Key/)).toBeNull();
  });

  it("a ?topic=<id> deep link expands every ancestor branch and surfaces the leaf", async () => {
    mockUseLocalSearchParams.mockReturnValue({ topic: "plans" });
    render(<HelpScreen />);
    await waitFor(() =>
      expect(screen.getByText(/Paid plans aren't available yet/)).toBeTruthy(),
    );
  });

  it("a ?topic=<id> deep link for a 3-level nested leaf expands all ancestors and surfaces it", async () => {
    mockUseLocalSearchParams.mockReturnValue({ topic: "draft-viewer" });
    render(<HelpScreen />);
    await waitFor(() => expect(screen.getByTestId("help-leaf-leaf-draft-viewer")).toBeTruthy());
    expect(screen.getByText("Read, approve & revise a draft")).toBeTruthy();
  });
});
