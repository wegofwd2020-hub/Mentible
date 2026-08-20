jest.mock("expo-secure-store", () => {
  let store: Record<string, string> = {};
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when_unlocked_this_device_only",
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    getItemAsync: jest.fn(async (key: string) => store[key] ?? null),
    deleteItemAsync: jest.fn(async (key: string) => {
      delete store[key];
    }),
    __reset: () => { store = {}; },
  };
});

import { saveLMK, loadLMK, clearLMK } from "@/sync/lmkStore";

const SecureStore = require("expo-secure-store") as {
  setItemAsync: jest.Mock;
  getItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
  __reset: () => void;
};

beforeEach(() => {
  jest.clearAllMocks();
  SecureStore.__reset();
});

describe("lmkStore", () => {
  it("round-trips a 32-byte LMK through secure-store", async () => {
    const lmk = new Uint8Array(32);
    for (let i = 0; i < 32; i++) lmk[i] = (i * 7 + 3) % 256;

    await saveLMK(lmk);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      "sbq_sync_lmk",
      expect.any(String),
      expect.any(Object),
    );
    // Never store the raw bytes/base64 of the key directly under a
    // predictable value shape check beyond "it's a string" — the point here
    // is the round trip, not the encoding.
    const loaded = await loadLMK();
    expect(loaded).toEqual(lmk);
  });

  it("returns null when nothing is cached", async () => {
    const loaded = await loadLMK();
    expect(loaded).toBeNull();
  });

  it("clearLMK removes the cached key", async () => {
    const lmk = new Uint8Array(32).fill(9);
    await saveLMK(lmk);
    await clearLMK();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("sbq_sync_lmk");
    expect(await loadLMK()).toBeNull();
  });

  it("uses WHEN_UNLOCKED_THIS_DEVICE_ONLY keychain accessibility", async () => {
    await saveLMK(new Uint8Array(32));
    const opts = SecureStore.setItemAsync.mock.calls[0][2];
    expect(opts.keychainAccessible).toBe("when_unlocked_this_device_only");
  });
});
