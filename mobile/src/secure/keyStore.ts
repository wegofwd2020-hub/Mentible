import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const KEY = "sbq_byok_key";

const isNative = Platform.OS !== "web";

// Web fallback: localStorage is not as secure as the Android Keystore but is
// sufficient for browser-based development and testing. The real target is
// Android (D3); web support here exists purely for the Expo web preview.
const webStore = {
  save: (key: string, value: string) => localStorage.setItem(key, value),
  load: (key: string) => localStorage.getItem(key),
  del:  (key: string) => localStorage.removeItem(key),
};

export async function saveApiKey(apiKey: string): Promise<void> {
  if (isNative) {
    await SecureStore.setItemAsync(KEY, apiKey, {
      requireAuthentication: false,
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } else {
    webStore.save(KEY, apiKey);
  }
}

export async function loadApiKey(): Promise<string | null> {
  if (isNative) return SecureStore.getItemAsync(KEY);
  return webStore.load(KEY);
}

export async function deleteApiKey(): Promise<void> {
  if (isNative) {
    await SecureStore.deleteItemAsync(KEY);
  } else {
    webStore.del(KEY);
  }
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length < 8) return "sk-ant-...????";
  const last4 = apiKey.slice(-4);
  return `sk-ant-...${last4}`;
}

export function isValidApiKey(value: string): boolean {
  return value.startsWith("sk-ant-") && value.length >= 20;
}
