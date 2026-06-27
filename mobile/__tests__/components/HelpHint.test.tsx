import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { HelpHint } from "../../src/components/HelpHint";

describe("HelpHint", () => {
  const TEXT = "Permanently deletes your account.";

  it("hides the hint until the ? is tapped, then toggles it", () => {
    render(<HelpHint label="Delete account" text={TEXT} />);
    // hidden initially
    expect(screen.queryByText(TEXT)).toBeNull();
    // the "?" is an accessible button labelled by the control
    const btn = screen.getByLabelText("Help: Delete account");
    fireEvent.press(btn);
    expect(screen.getByText(TEXT)).toBeTruthy();
    // tapping again dismisses it
    fireEvent.press(btn);
    expect(screen.queryByText(TEXT)).toBeNull();
  });

  it("falls back to a generic accessibility label without one", () => {
    render(<HelpHint text={TEXT} />);
    expect(screen.getByLabelText("Help")).toBeTruthy();
  });
});
