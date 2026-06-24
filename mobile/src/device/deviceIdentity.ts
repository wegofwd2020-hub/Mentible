import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { randomUUID } from "@/lib/uuid";

// A stable per-install device identity, reported to the backend on sign-in so the
// admin view can show how many devices an account uses. The id is random and
// opaque — it carries no personal data and never any key material. It lives in
// the device keystore (localStorage on web), so reinstalling / clearing app data
// yields a fresh id, which correctly reads as a new device.

const DEVICE_ID_KEY = "mentible_device_id";
const isNative = Platform.OS !== "web";

const webStore = {
  load: (key: string) => (typeof localStorage !== "undefined" ? localStorage.getItem(key) : null),
  save: (key: string, value: string) => {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  },
};

export async function getOrCreateDeviceId(): Promise<string> {
  if (isNative) {
    const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = randomUUID();
    await SecureStore.setItemAsync(DEVICE_ID_KEY, id, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return id;
  }
  const existing = webStore.load(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = randomUUID();
  webStore.save(DEVICE_ID_KEY, id);
  return id;
}

// "ios" | "android" | "web" — matches the backend's free-form platform field.
export function devicePlatform(): string {
  return Platform.OS;
}

// A short, friendly label for the admin view. Best-effort and dependency-free
// (no expo-device); enough to tell devices apart at a glance.
export function deviceLabel(): string {
  if (Platform.OS === "web") return "Web browser";
  if (Platform.OS === "ios") return `iOS ${Platform.Version}`;
  if (Platform.OS === "android") return `Android ${Platform.Version}`;
  return Platform.OS;
}
