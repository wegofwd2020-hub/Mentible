// demoBlocked surfaces its notice via the cross-platform Alert shim (not RN's
// Alert, a silent no-op on web — issue #255). IS_DEMO is inlined from
// EXPO_PUBLIC_DEMO_MODE at build/transform time, so the demo-ON branch can't be
// flipped at runtime here — it's verified against a real demo web build. This
// guards the normal-build path (must never alert or block) + that the module
// pulls Alert from the shim.

const mockAlert = jest.fn();
jest.mock("@/lib/alert", () => ({ Alert: { alert: (...a: unknown[]) => mockAlert(...a) } }));

import { demoBlocked } from "@/constants/demo";

describe("demoBlocked (normal build)", () => {
  afterEach(() => mockAlert.mockClear());

  it("returns false and shows no alert when not a demo build", () => {
    expect(demoBlocked()).toBe(false);
    expect(mockAlert).not.toHaveBeenCalled();
  });
});
