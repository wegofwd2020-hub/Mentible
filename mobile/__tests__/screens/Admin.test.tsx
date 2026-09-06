import React from "react";
import { render, screen } from "@testing-library/react-native";

const mockPush = jest.fn();
jest.mock("expo-router", () => {
  const React_ = require("react");
  const { Text } = require("react-native");
  return {
    useRouter: () => ({ push: mockPush }),
    // Real useFocusEffect runs on focus (once), not every render — model that with
    // a mount effect so a callback that sets state can't loop.
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

jest.mock("../../src/api/adminClient", () => ({ listUsers: jest.fn() }));
const { listUsers } = require("../../src/api/adminClient") as { listUsers: jest.Mock };

import AdminScreen from "../../app/admin";

beforeEach(() => {
  jest.clearAllMocks();
  mockAccount = { is_super_admin: true };
});

describe("AdminScreen", () => {
  it("lists users with email + device count for a super-admin", async () => {
    listUsers.mockResolvedValue({
      users: [
        { sub: "u1", email: "alice@x.com", created_at: "2026-06-01T00:00:00Z", suspended: false, suspended_at: null, device_count: 2 },
      ],
      total: 1,
      limit: 200,
      offset: 0,
    });
    render(<AdminScreen />);
    expect(await screen.findByText("alice@x.com")).toBeTruthy();
    expect(screen.getByText(/2 devices/)).toBeTruthy();
  });

  it("redirects a non-admin to settings", async () => {
    // The redirect + backend admin gate are the access control — the list load
    // is intentionally not gated on `isAdmin` (so a slow/failing /account can't
    // hang the screen), so a non-admin may fire one 403'd request before the
    // redirect. What matters is they never SEE data — the redirect guarantees it.
    mockAccount = { is_super_admin: false };
    render(<AdminScreen />);
    expect(await screen.findByText("redirect:/settings")).toBeTruthy();
  });
});
