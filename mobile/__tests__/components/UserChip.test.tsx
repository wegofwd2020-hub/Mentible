import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";

let mockAuth: { status: string; session: unknown } = { status: "signed_in", session: null };
jest.mock("../../src/auth/AuthProvider", () => ({
  useAuth: () => mockAuth,
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));

import { UserChip } from "../../src/components/UserChip";

beforeEach(() => {
  jest.clearAllMocks();
});

function signedIn(meta: Record<string, unknown>, email = "ada@x.com") {
  mockAuth = { status: "signed_in", session: { user: { user_metadata: meta, email } } };
}

describe("UserChip", () => {
  it("renders nothing when auth is unavailable (demo / unconfigured)", () => {
    mockAuth = { status: "unavailable", session: null };
    const { toJSON } = render(<UserChip />);
    expect(toJSON()).toBeNull();
  });

  it("renders nothing when signed out (the nav's own Sign-in button covers that)", () => {
    mockAuth = { status: "signed_out", session: null };
    const { toJSON } = render(<UserChip />);
    expect(toJSON()).toBeNull();
  });

  it("shows the avatar labelled with the name and opens Account on tap", () => {
    signedIn({ full_name: "Ada Lovelace", avatar_url: "https://x/p.png" });
    render(<UserChip />);
    fireEvent.press(screen.getByLabelText("Account: Ada Lovelace"));
    expect(mockPush).toHaveBeenCalledWith("/account");
  });

  it("falls back to initials when no photo, labelling the avatar with the email", () => {
    signedIn({}); // no full_name, no avatar → name falls back to email
    render(<UserChip />);
    expect(screen.getByLabelText("Account: ada@x.com")).toBeTruthy();
    expect(screen.getByText("A")).toBeTruthy(); // initials of "ada@x.com"
  });
});
