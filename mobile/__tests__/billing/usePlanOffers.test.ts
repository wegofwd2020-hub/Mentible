import { act, renderHook, waitFor } from "@testing-library/react-native";
import { __setPurchaseController } from "@/billing/purchaseController";
import { usePlanOffers } from "@/billing/usePlanOffers";
import type { PlanOffer, PurchaseController } from "@/billing/types";

const OFFER: PlanOffer = {
  id: "managed_basic",
  kind: "managed",
  title: "Managed",
  price: "$9.99/mo",
  period: "month",
  blurb: "b",
  renewalTerms: "t",
};

function controller(over: Partial<PurchaseController> = {}): PurchaseController {
  return {
    offerings: jest.fn().mockResolvedValue([OFFER]),
    purchase: jest.fn(),
    restore: jest.fn(),
    ...over,
  };
}

afterEach(() => __setPurchaseController(null));

describe("usePlanOffers", () => {
  it("starts loading, then resolves to ready with the offers", async () => {
    __setPurchaseController(controller());
    const { result } = renderHook(() => usePlanOffers());
    expect(result.current.state.kind).toBe("loading");
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    if (result.current.state.kind !== "ready") throw new Error("expected ready");
    expect(result.current.state.offers).toEqual([OFFER]);
  });

  it("goes to error when offerings() rejects", async () => {
    __setPurchaseController(
      controller({ offerings: jest.fn().mockRejectedValue(new Error("boom")) }),
    );
    const { result } = renderHook(() => usePlanOffers());
    await waitFor(() => expect(result.current.state.kind).toBe("error"));
  });

  it("reload() retries and can recover from error to ready", async () => {
    const offerings = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([OFFER]);
    __setPurchaseController(controller({ offerings }));
    const { result } = renderHook(() => usePlanOffers());
    await waitFor(() => expect(result.current.state.kind).toBe("error"));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    expect(offerings).toHaveBeenCalledTimes(2);
  });
});
