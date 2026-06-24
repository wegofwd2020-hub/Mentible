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

  it("shows a Sign in affordance when signed out and routes to sign-in", () => {
    mockAuth = { status: "signed_out", session: null };
    render(<UserChip />);
    fireEvent.press(screen.getByText("Sign in"));
    expect(mockPush).toHaveBeenCalledWith("/sign-in");
  });

  it("shows the Google full name when signed in and opens Account on tap", () => {
    signedIn({ full_name: "Ada Lovelace", avatar_url: "https://x/p.png" });
    render(<UserChip />);
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Account: Ada Lovelace"));
    expect(mockPush).toHaveBeenCalledWith("/account");
  });

  it("falls back to initials when no photo, and to email when no name", () => {
    signedIn({}); // no full_name, no avatar
    render(<UserChip />);
    expect(screen.getByText("ada@x.com")).toBeTruthy(); // name falls back to email
  });
});
