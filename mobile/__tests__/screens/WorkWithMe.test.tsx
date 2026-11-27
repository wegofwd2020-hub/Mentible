import React from "react";
import { Linking } from "react-native";
import { render, fireEvent } from "@testing-library/react-native";
import WorkWithMeScreen, { SCHEDULER_URL, SALES_EMAIL } from "@/../app/work-with-me";

describe("WorkWithMeScreen", () => {
  beforeEach(() => {
    jest.spyOn(Linking, "openURL").mockResolvedValue(true as unknown as void);
  });
  afterEach(() => jest.restoreAllMocks());

  it("renders the hero, the three engagement tiers, and the book CTA", () => {
    const { getByText, getByLabelText } = render(<WorkWithMeScreen />);
    expect(getByText(/turn your expertise into validated/i)).toBeTruthy();
    expect(getByText("Discovery")).toBeTruthy();
    expect(getByText("Sprint")).toBeTruthy();
    expect(getByText("Pilot")).toBeTruthy();
    expect(getByLabelText("Book a 30-minute conversation")).toBeTruthy();
  });

  it("opens the scheduler URL when the book button is pressed", () => {
    const { getByLabelText } = render(<WorkWithMeScreen />);
    fireEvent.press(getByLabelText("Book a 30-minute conversation"));
    expect(Linking.openURL).toHaveBeenCalledWith(SCHEDULER_URL);
  });

  it("offers a mailto fallback", () => {
    const { getByLabelText } = render(<WorkWithMeScreen />);
    fireEvent.press(getByLabelText("Email me instead"));
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining(`mailto:${SALES_EMAIL}`));
  });

  it("uses the sales address and shows the Publish step, not Share", () => {
    const { getByText, queryByText } = render(<WorkWithMeScreen />);
    expect(SALES_EMAIL).toBe("sales@kaundinyalabs.com");
    expect(getByText(/Validate, Publish\./)).toBeTruthy();
    expect(queryByText(/Validate, Share\./)).toBeNull();
  });
});
