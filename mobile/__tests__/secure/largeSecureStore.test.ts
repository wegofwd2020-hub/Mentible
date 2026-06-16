import AsyncStorage from "@react-native-async-storage/async-storage";

// In-memory expo-secure-store (the AES key store) + deterministic key material,
// so the AES round-trip is exercised for real (aes-js is unmocked). AsyncStorage
// is the in-memory mock from jest.setup.
jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    setItemAsync: jest.fn((k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve();
    }),
    getItemAsync: jest.fn((k: string) => Promise.resolve(store.has(k) ? store.get(k) : null)),
    deleteItemAsync: jest.fn((k: string) => {
      store.delete(k);
      return Promise.resolve();
    }),
  };
});

jest.mock("expo-crypto", () => ({
  getRandomBytes: (n: number) => new Uint8Array(n).fill(7), // deterministic test key
}));

import { largeSecureStore } from "@/secure/largeSecureStore";

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe("largeSecureStore", () => {
  it("round-trips a value, storing only ciphertext in AsyncStorage", async () => {
    // A big value — well past expo-secure-store's ~2KB limit — to prove the
    // ciphertext-in-AsyncStorage approach handles large sessions.
    const value = "session-token-".repeat(500);
    await largeSecureStore.setItem("sb-session", value);

    const stored = await AsyncStorage.getItem("sb-session");
    expect(stored).not.toBeNull();
    expect(stored).not.toContain("session-token"); // encrypted, not plaintext

    expect(await largeSecureStore.getItem("sb-session")).toBe(value);
  });

  it("keeps the AES key in secure-store, not AsyncStorage", async () => {
    const SecureStore = require("expo-secure-store");
    await largeSecureStore.setItem("k", "v");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("k", expect.any(String));
  });

  it("returns null for an absent key", async () => {
    expect(await largeSecureStore.getItem("missing")).toBeNull();
  });

  it("removeItem clears both the ciphertext and the key", async () => {
    const SecureStore = require("expo-secure-store");
    await largeSecureStore.setItem("k", "v");
    await largeSecureStore.removeItem("k");
    expect(await largeSecureStore.getItem("k")).toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("k");
  });
});
