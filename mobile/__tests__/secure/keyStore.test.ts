import { deleteApiKey, isValidApiKey, loadApiKey, maskApiKey, saveApiKey } from "../../src/secure/keyStore";

jest.mock("expo-secure-store", () => {
  const store: Record<string, string> = {};
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when_unlocked_this_device_only",
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    getItemAsync: jest.fn(async (key: string) => store[key] ?? null),
    deleteItemAsync: jest.fn(async (key: string) => {
      delete store[key];
    }),
  };
});

const SecureStore = require("expo-secure-store") as {
  setItemAsync: jest.Mock;
  getItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("saveApiKey / loadApiKey / deleteApiKey", () => {
  it("saves and loads a key", async () => {
    await saveApiKey("sk-ant-test-key-abcdef");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      "sbq_byok_key",
      "sk-ant-test-key-abcdef",
      expect.any(Object),
    );

    SecureStore.getItemAsync.mockResolvedValueOnce("sk-ant-test-key-abcdef");
    const loaded = await loadApiKey();
    expect(loaded).toBe("sk-ant-test-key-abcdef");
  });

  it("returns null when no key stored", async () => {
    SecureStore.getItemAsync.mockResolvedValueOnce(null);
    const loaded = await loadApiKey();
    expect(loaded).toBeNull();
  });

  it("deletes the key", async () => {
    await deleteApiKey();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("sbq_byok_key");
  });
});

describe("maskApiKey", () => {
  it("masks all but the last 4 characters", () => {
    const mask = maskApiKey("sk-ant-api03-xxxx1234");
    expect(mask).toBe("sk-ant-...1234");
    expect(mask).not.toContain("api03");
  });

  it("handles very short strings", () => {
    const mask = maskApiKey("ab");
    expect(mask).toBe("sk-ant-...????");
  });
});

describe("isValidApiKey", () => {
  it("accepts valid keys", () => {
    expect(isValidApiKey("sk-ant-FAKE_KEY_abcdefghijklmn")).toBe(true);
  });

  it("rejects keys not starting with sk-ant-", () => {
    expect(isValidApiKey("sk-OPENAI-FAKEXXX")).toBe(false);
  });

  it("rejects keys shorter than 20 chars", () => {
    expect(isValidApiKey("sk-ant-short")).toBe(false);
  });
});
