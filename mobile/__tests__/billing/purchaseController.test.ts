import {
  __setPurchaseController,
  getPurchaseController,
} from "@/billing/purchaseController";
import { devPurchaseController } from "@/billing/devPurchaseController";
import type { PurchaseController } from "@/billing/types";

afterEach(() => __setPurchaseController(null));

describe("purchase seam", () => {
  it("defaults to the dev controller", () => {
    expect(getPurchaseController()).toBe(devPurchaseController);
  });

  it("__setPurchaseController overrides it, and null restores the default", () => {
    const fake: PurchaseController = {
      offerings: jest.fn(),
      purchase: jest.fn(),
      restore: jest.fn(),
    };
    __setPurchaseController(fake);
    expect(getPurchaseController()).toBe(fake);
    __setPurchaseController(null);
    expect(getPurchaseController()).toBe(devPurchaseController);
  });
});

describe("devPurchaseController", () => {
  it("offers exactly one managed and one byok plan, managed first", async () => {
    const offers = await devPurchaseController.offerings();
    expect(offers.map((o) => o.kind)).toEqual(["managed", "byok"]);
  });

  it("gives the managed offer the backend plans.py plan id", async () => {
    const [managed] = await devPurchaseController.offerings();
    expect(managed.id).toBe("managed_basic");
  });

  it("gives every offer non-empty renewal terms", async () => {
    const offers = await devPurchaseController.offerings();
    for (const o of offers) expect(o.renewalTerms.length).toBeGreaterThan(0);
  });

  it("never markets unlimited generation on the managed plan", async () => {
    const [managed] = await devPurchaseController.offerings();
    expect(`${managed.title} ${managed.blurb}`.toLowerCase()).not.toContain("unlimited");
  });

  it("purchase() resolves unavailable and never throws", async () => {
    await expect(devPurchaseController.purchase("managed_basic")).resolves.toEqual({
      kind: "unavailable",
      reason: expect.any(String),
    });
  });

  it("restore() resolves unavailable and never throws", async () => {
    await expect(devPurchaseController.restore()).resolves.toEqual({
      kind: "unavailable",
      reason: expect.any(String),
    });
  });
});
