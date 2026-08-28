import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => {
  const React_ = require("react");
  const { Text } = require("react-native");
  return {
    useFocusEffect: (cb: () => void) => {
      React_.useEffect(() => cb(), []);
    },
    Redirect: ({ href }: { href: string }) => React_.createElement(Text, null, `redirect:${href}`),
  };
});

jest.mock("../../src/auth/AuthProvider", () => ({
  useAuth: () => ({ status: "signed_in", accessToken: "tok", session: null }),
}));

let mockAccount: { is_super_admin: boolean } | null = { is_super_admin: true };
jest.mock("../../src/hooks/useAccount", () => ({
  useAccount: () => ({ account: mockAccount }),
}));

jest.mock("../../src/api/adminClient", () => ({ getUsageByUser: jest.fn() }));
const { getUsageByUser } = require("../../src/api/adminClient") as { getUsageByUser: jest.Mock };

import AdminUsageScreen from "../../app/admin/usage";

beforeEach(() => {
  jest.clearAllMocks();
  mockAccount = { is_super_admin: true };
});

describe("AdminUsageScreen", () => {
  it("shows per-user token usage + grand totals for a super-admin", async () => {
    getUsageByUser.mockResolvedValue({
      window_days: 30,
      rows: [
        {
          sub: "u1", email: "alice@x.com", input_tokens: 2000, output_tokens: 5000,
          total_tokens: 7000, cost_micros: 0, events: 3, providers: ["groq"],
          last_used: "2026-08-27T00:00:00Z",
        },
      ],
      total_input_tokens: 2000,
      total_output_tokens: 5000,
      total_cost_micros: 0,
    });
    render(<AdminUsageScreen />);
    expect(await screen.findByText("alice@x.com")).toBeTruthy();
    expect(screen.getByText("7,000 tok")).toBeTruthy();       // per-user total
    expect(screen.getByText(/7,000 tokens/)).toBeTruthy();     // grand total
    expect(screen.getByText(/groq/)).toBeTruthy();
    // managed-only disclaimer is present
    expect(screen.getByText(/BYOK usage isn.t metered/)).toBeTruthy();
  });

  it("redirects a non-admin to settings and never calls the admin API", async () => {
    mockAccount = { is_super_admin: false };
    render(<AdminUsageScreen />);
    expect(await screen.findByText("redirect:/settings")).toBeTruthy();
    await waitFor(() => expect(getUsageByUser).not.toHaveBeenCalled());
  });
});
