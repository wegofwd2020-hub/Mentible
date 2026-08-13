import { renderHook, waitFor } from "@testing-library/react-native";

// Self-contained mocks (jest hoists these above imports).
const mockGetManagedStatus = jest.fn();
jest.mock("@/api/billingClient", () => ({
  getManagedStatus: (...args: unknown[]) => mockGetManagedStatus(...args),
}));

let mockAccessToken: string | null = "tok";
jest.mock("@/auth/AuthProvider", () => ({
  useAuth: () => ({ accessToken: mockAccessToken }),
}));

jest.mock("expo-router", () => ({
  // Fire the focus callback once on mount (via an effect), like the real
  // useFocusEffect — NOT on every render, which would loop when the callback
  // sets state.
  useFocusEffect: (cb: () => void) => {
    require("react").useEffect(cb, []);
  },
}));

import { useManagedStatus } from "@/hooks/useManagedStatus";

const STATUS = {
  entitlement: {
    plan_id: "pro",
    plan_display: "Pro",
    status: "active" as const,
    period_start: "2026-08-01",
    period_end: "2026-09-01",
  },
  usage: { cost_micros: 1_000_000, input_tokens: 100, output_tokens: 50, events: 3 },
  allowance_micros: 5_000_000,
  window_start: "2026-08-01",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAccessToken = "tok";
});

describe("useManagedStatus", () => {
  it("fetches and returns status when signed in", async () => {
    mockGetManagedStatus.mockResolvedValue(STATUS);
    const { result } = renderHook(() => useManagedStatus());
    await waitFor(() => expect(result.current.status).not.toBeNull());
    expect(result.current.status).toEqual(STATUS);
    expect(mockGetManagedStatus).toHaveBeenCalledWith("tok");
  });

  it("returns status:null and does not fetch when signed out", async () => {
    mockAccessToken = null;
    const { result } = renderHook(() => useManagedStatus());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status).toBeNull();
    expect(mockGetManagedStatus).not.toHaveBeenCalled();
  });

  it("returns status:null (no throw) when the fetch rejects", async () => {
    mockGetManagedStatus.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useManagedStatus());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status).toBeNull();
  });
});
