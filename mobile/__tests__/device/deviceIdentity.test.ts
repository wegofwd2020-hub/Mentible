import { Platform } from "react-native";

const store: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    store[k] = v;
  }),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "unlocked-this-device",
}));

let counter = 0;
jest.mock("../../src/lib/uuid", () => ({ randomUUID: () => `uuid-${(counter += 1)}` }));

import { deviceLabel, devicePlatform, getOrCreateDeviceId } from "../../src/device/deviceIdentity";

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  counter = 0;
});

describe("deviceIdentity", () => {
  it("generates an id on first use and returns the same id thereafter", async () => {
    const first = await getOrCreateDeviceId();
    const second = await getOrCreateDeviceId();
    expect(first).toBe("uuid-1");
    expect(second).toBe(first); // stable across calls
    expect(store["mentible_device_id"]).toBe(first); // persisted
  });

  it("returns an already-stored id without generating a new one", async () => {
    store["mentible_device_id"] = "preexisting-id";
    expect(await getOrCreateDeviceId()).toBe("preexisting-id");
    expect(counter).toBe(0); // no new uuid minted
  });

  it("exposes the platform and a non-empty label", () => {
    expect(devicePlatform()).toBe(Platform.OS);
    expect(deviceLabel().length).toBeGreaterThan(0);
  });
});
