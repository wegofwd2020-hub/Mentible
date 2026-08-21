import React from "react";
import { render, fireEvent } from "@testing-library/react-native";

const mockPush = jest.fn();
const mockSignOut = jest.fn().mockResolvedValue(undefined);

jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/auth/AuthProvider", () => ({
  useAuth: () => ({ status: "signed_in", session: { user: { email: "a@b.co" } }, signOut: mockSignOut }),
}));

import { AccountMenu } from "@/components/AccountMenu";

describe("AccountMenu", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockSignOut.mockClear();
  });

  test("opens and lists account actions", () => {
    const { getByLabelText, getByText } = render(<AccountMenu />);
    fireEvent.press(getByLabelText(/account menu/i));
    ["Settings", "Help", "About", "Sign out"].forEach((t) => expect(getByText(t)).toBeTruthy());
  });

  test("Sign out calls useAuth().signOut", () => {
    const { getByLabelText, getByText } = render(<AccountMenu />);
    fireEvent.press(getByLabelText(/account menu/i));
    fireEvent.press(getByText("Sign out"));
    expect(mockSignOut).toHaveBeenCalled();
  });

  test("Settings navigates via router.push", () => {
    const { getByLabelText, getByText } = render(<AccountMenu />);
    fireEvent.press(getByLabelText(/account menu/i));
    fireEvent.press(getByText("Settings"));
    expect(mockPush).toHaveBeenCalledWith("/settings");
  });
});
