// savedProviders() — the device-local half of the "your providers / access" card.
// Self-contained expo-secure-store mock (a fresh implementation per test) so a
// rejected-read case can't leak its implementation into another test.
import { savedProviders } from "../../src/secure/keyStore";

jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when_unlocked_this_device_only",
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const SecureStore = require("expo-secure-store") as { getItemAsync: jest.Mock };

// storageKey(): anthropic keeps the legacy slot; others are namespaced.
const SLOT: Record<string, string> = {
  anthropic: "sbq_byok_key",
  openai: "sbq_byok_key_openai",
  groq: "sbq_byok_key_groq",
  openrouter: "sbq_byok_key_openrouter",
  gemini: "sbq_byok_key_gemini",
};

beforeEach(() => jest.clearAllMocks());

it("lists only providers that have a key on this device", async () => {
  const present = new Set([SLOT.anthropic, SLOT.groq]);
  SecureStore.getItemAsync.mockImplementation(async (key: string) =>
    present.has(key) ? "the-key" : null,
  );
  const saved = await savedProviders();
  expect(saved).toContain("anthropic");
  expect(saved).toContain("groq");
  expect(saved).not.toContain("openai");
  expect(saved).not.toContain("gemini");
});

it("is empty when no keys are stored", async () => {
  SecureStore.getItemAsync.mockResolvedValue(null);
  expect(await savedProviders()).toEqual([]);
});

it("tolerates a failed read (locked keychain) as unsaved — no throw, no phantoms", async () => {
  SecureStore.getItemAsync.mockRejectedValue(new Error("keychain locked"));
  expect(await savedProviders()).toEqual([]);
});
