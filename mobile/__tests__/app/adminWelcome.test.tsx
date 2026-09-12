import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";

let mockParams: { email?: string; name?: string } = {};
jest.mock("expo-router", () => {
  const React_ = require("react");
  const { Text } = require("react-native");
  return {
    useLocalSearchParams: () => mockParams,
    Redirect: ({ href }: { href: string }) => React_.createElement(Text, null, `redirect:${href}`),
  };
});

jest.mock("@/auth/AuthProvider", () => ({
  useAuth: () => ({ status: "signed_in", accessToken: "t", session: null }),
}));

let mockAccount: { is_super_admin: boolean } | null = { is_super_admin: true };
jest.mock("@/hooks/useAccount", () => ({ useAccount: () => ({ account: mockAccount }) }));

jest.mock("@/api/adminClient", () => ({
  sendWelcomeEmail: jest.fn(async () => ({ sent: true, detail: "sent" })),
}));
const { sendWelcomeEmail } = require("@/api/adminClient") as { sendWelcomeEmail: jest.Mock };

import AdminWelcomeScreen from "../../app/admin/welcome";

beforeEach(() => {
  jest.clearAllMocks();
  mockAccount = { is_super_admin: true };
  mockParams = {};
});

describe("AdminWelcomeScreen", () => {
  it("sends the welcome email and shows a success line", async () => {
    render(<AdminWelcomeScreen />);
    fireEvent.changeText(screen.getByLabelText("Recipient email"), "new@x.com");
    fireEvent.changeText(screen.getByLabelText("Recipient name"), "Sam");
    fireEvent.press(screen.getByLabelText("Send welcome email"));
    await waitFor(() => expect(sendWelcomeEmail).toHaveBeenCalledWith("t", "new@x.com", "Sam"));
    expect(await screen.findByText(/Sent to new@x.com/)).toBeTruthy();
  });

  it("surfaces a not-sent reason from the backend", async () => {
    sendWelcomeEmail.mockResolvedValueOnce({ sent: false, detail: "email is not configured" });
    render(<AdminWelcomeScreen />);
    fireEvent.changeText(screen.getByLabelText("Recipient email"), "new@x.com");
    fireEvent.press(screen.getByLabelText("Send welcome email"));
    expect(await screen.findByText(/Not sent — email is not configured/)).toBeTruthy();
  });

  it("prefills the recipient from query params", () => {
    mockParams = { email: "pref@x.com", name: "Pat" };
    render(<AdminWelcomeScreen />);
    expect(screen.getByLabelText("Recipient email").props.value).toBe("pref@x.com");
    expect(screen.getByLabelText("Recipient name").props.value).toBe("Pat");
  });

  it("redirects a non-admin to settings", () => {
    mockAccount = { is_super_admin: false };
    render(<AdminWelcomeScreen />);
    expect(screen.getByText("redirect:/settings")).toBeTruthy();
  });
});
