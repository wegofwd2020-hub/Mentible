import React from "react";
import { Text } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";

let mockStatus = "signed_in";
jest.mock("../../src/auth/AuthProvider", () => ({
  useAuth: () => ({ status: mockStatus, session: null, accessToken: null }),
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));

import { RequireSignIn } from "../../src/auth/RequireSignIn";

const Inner = () => <Text>INNER</Text>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("RequireSignIn", () => {
  it("renders children when signed in", () => {
    mockStatus = "signed_in";
    render(
      <RequireSignIn action="create a book">
        <Inner />
      </RequireSignIn>,
    );
    expect(screen.getByText("INNER")).toBeTruthy();
  });

  it("renders children when auth is unavailable (demo / unconfigured — don't trap)", () => {
    mockStatus = "unavailable";
    render(
      <RequireSignIn action="create a book">
        <Inner />
      </RequireSignIn>,
    );
    expect(screen.getByText("INNER")).toBeTruthy();
  });

  it("blocks with a sign-in interstitial when signed out, and routes to sign-in", () => {
    mockStatus = "signed_out";
    render(
      <RequireSignIn action="create a book">
        <Inner />
      </RequireSignIn>,
    );
    expect(screen.queryByText("INNER")).toBeNull();
    expect(screen.getByText("Sign in to create a book")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Sign in to create a book"));
    expect(mockPush).toHaveBeenCalledWith("/sign-in");
  });

  it("shows neither children nor the interstitial while auth is loading", () => {
    mockStatus = "loading";
    render(
      <RequireSignIn action="create a book">
        <Inner />
      </RequireSignIn>,
    );
    expect(screen.queryByText("INNER")).toBeNull();
    expect(screen.queryByText("Sign in to create a book")).toBeNull();
  });
});
