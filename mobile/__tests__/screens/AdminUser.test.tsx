import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => {
  const React_ = require("react");
  const { Text } = require("react-native");
  return {
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    useLocalSearchParams: () => ({ sub: "sub-1" }),
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

jest.mock("../../src/hooks/useAccount", () => ({
  useAccount: () => ({ account: { is_super_admin: true } }),
}));

jest.mock("../../src/api/adminClient", () => ({
  getUser: jest.fn(),
  suspendUser: jest.fn(),
  reactivateUser: jest.fn(),
  deleteUser: jest.fn(),
  listPlans: jest.fn(),
  getEntitlement: jest.fn(),
  grantEntitlement: jest.fn(),
  revokeEntitlement: jest.fn(),
}));
const {
  getUser,
  listPlans,
  getEntitlement,
  grantEntitlement,
  revokeEntitlement,
} = require("../../src/api/adminClient") as {
  getUser: jest.Mock;
  listPlans: jest.Mock;
  getEntitlement: jest.Mock;
  grantEntitlement: jest.Mock;
  revokeEntitlement: jest.Mock;
};

import AdminUserScreen from "../../app/admin/[sub]";

const PLANS = [
  { id: "managed_unlimited", display: "Managed Unlimited", allowance_micros: 0, managed_providers: ["anthropic"] },
  { id: "managed_basic", display: "Managed Basic", allowance_micros: 5000000, managed_providers: ["anthropic"] },
];

const USER = {
  sub: "sub-1",
  email: "alice@x.com",
  created_at: "2026-06-01T00:00:00Z",
  suspended: false,
  suspended_at: null,
  device_count: 0,
  credentials: [],
  devices: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue(USER);
  listPlans.mockResolvedValue(PLANS);
});

describe("AdminUserScreen — Plan section", () => {
  it("shows Free + a grant control when there is no entitlement", async () => {
    getEntitlement.mockResolvedValue(null);
    render(<AdminUserScreen />);
    expect(await screen.findByText("No managed plan — Free")).toBeTruthy();
    expect(screen.getByText("Grant Managed Unlimited")).toBeTruthy();
    expect(screen.queryByText("Revoke plan")).toBeNull();
  });

  it("grants a plan when its control is pressed", async () => {
    getEntitlement.mockResolvedValue(null);
    grantEntitlement.mockResolvedValue({
      plan_id: "managed_unlimited",
      status: "active",
      period_start: "2026-08-01T00:00:00Z",
      period_end: "2026-09-01T00:00:00Z",
    });
    render(<AdminUserScreen />);
    const grant = await screen.findByText("Grant Managed Unlimited");
    fireEvent.press(grant);
    await waitFor(() =>
      expect(grantEntitlement).toHaveBeenCalledWith("tok", "sub-1", "managed_unlimited"),
    );
  });

  it("shows the plan + status and a Revoke control when there is an active entitlement", async () => {
    getEntitlement.mockResolvedValue({
      plan_id: "managed_unlimited",
      status: "active",
      period_start: "2026-08-01T00:00:00Z",
      period_end: "2026-09-01T00:00:00Z",
    });
    render(<AdminUserScreen />);
    expect(await screen.findByText("Managed Unlimited")).toBeTruthy();
    expect(screen.getByText("active")).toBeTruthy();
    expect(screen.getByText("Revoke plan")).toBeTruthy();
  });

  it("revokes the current plan when Revoke is pressed", async () => {
    getEntitlement.mockResolvedValue({
      plan_id: "managed_unlimited",
      status: "active",
      period_start: "2026-08-01T00:00:00Z",
      period_end: "2026-09-01T00:00:00Z",
    });
    revokeEntitlement.mockResolvedValue({
      plan_id: "managed_unlimited",
      status: "canceled",
      period_start: "2026-08-01T00:00:00Z",
      period_end: "2026-09-01T00:00:00Z",
    });
    render(<AdminUserScreen />);
    const revoke = await screen.findByText("Revoke plan");
    fireEvent.press(revoke);
    await waitFor(() =>
      expect(revokeEntitlement).toHaveBeenCalledWith("tok", "sub-1", "managed_unlimited"),
    );
  });
});
