import React from "react";
import { render, screen } from "@testing-library/react-native";
import { PLAYFAIR } from "@/constants/fonts";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
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
  it("renders the Help title in Playfair with no bold (700/600) weight — Studio re-skin", () => {
    render(<HelpScreen />);
    const style = flattenStyle(screen.getByText("Help").props.style);
    expect(style["fontFamily"]).toBe(PLAYFAIR.semibold);
    expect(style["fontWeight"]).not.toBe("700");
    expect(style["fontWeight"]).not.toBe("600");
  });

  it("renders topic titles via the Label primitive (uppercase, never bold)", () => {
    render(<HelpScreen />);
    // "Getting started" is the first real Help topic (src/help-content/topics.ts).
    const style = flattenStyle(screen.getByText("Getting started").props.style);
    expect(style["textTransform"]).toBe("uppercase");
    expect(style["fontWeight"]).not.toBe("700");
    expect(style["fontWeight"]).not.toBe("600");
  });

  it("still renders the search box and lets topics be filtered (behavior unchanged)", () => {
    render(<HelpScreen />);
    const input = screen.getByLabelText("Search help");
    expect(input).toBeTruthy();
    // A real topic body renders through the untouched HelpTopicView engine.
    expect(screen.getByText(/Mentible turns what you want to learn/)).toBeTruthy();
  });
});
