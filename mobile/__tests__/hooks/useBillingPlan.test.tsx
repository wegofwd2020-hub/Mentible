import { renderHook, waitFor } from "@testing-library/react-native";

// Self-contained mocks (jest hoists these above imports).
const mockGetPlanStatus = jest.fn();
jest.mock("@/api/billingClient", () => ({
  getPlanStatus: (...args: unknown[]) => mockGetPlanStatus(...args),
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

import { useBillingPlan } from "@/hooks/useBillingPlan";

const PLAN = {
  is_pro: false,
  caps: { max_projects: 3, max_generations: 10, gen_window_days: 30 },
  usage: { projects: 1, generations: 2 },
  at_project_cap: false,
  at_generation_cap: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAccessToken = "tok";
});

describe("useBillingPlan", () => {
  it("fetches and returns the plan when signed in", async () => {
    mockGetPlanStatus.mockResolvedValue(PLAN);
    const { result } = renderHook(() => useBillingPlan());
    await waitFor(() => expect(result.current.plan).not.toBeNull());
    expect(result.current.plan).toEqual(PLAN);
    expect(mockGetPlanStatus).toHaveBeenCalledWith("tok");
  });

  it("returns plan:null and does not fetch when signed out", async () => {
    mockAccessToken = null;
    const { result } = renderHook(() => useBillingPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.plan).toBeNull();
    expect(mockGetPlanStatus).not.toHaveBeenCalled();
  });

  it("returns plan:null (no throw) when the fetch rejects — fails open", async () => {
    mockGetPlanStatus.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useBillingPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.plan).toBeNull();
  });
});
