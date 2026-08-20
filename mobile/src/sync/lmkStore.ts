// Device-local cache for the unwrapped Local Master Key (LMK, ADR-014
// zero-knowledge sync). Mirrors `secure/keyStore.ts`'s platform split exactly:
// native → Android Keystore-backed `expo-secure-store`
// (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`); web → `localStorage` fallback (dev/
// preview only — the real target is Android, D3). The LMK itself never
// leaves the device un-wrapped; this is the ONLY place it's cached in the
// clear, and it's never AsyncStorage/IndexedDB (CLAUDE.md: no secret in clear
// storage on native).
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import * as aesjs from "aes-js";

const LMK_KEY = "sbq_sync_lmk";

const isNative = Platform.OS !== "web";

const webStore = {
  save: (key: string, value: string) => localStorage.setItem(key, value),
  load: (key: string) => localStorage.getItem(key),
  del: (key: string) => localStorage.removeItem(key),
};

export async function saveLMK(bytes: Uint8Array): Promise<void> {
  const hex = aesjs.utils.hex.fromBytes(bytes);
  if (isNative) {
    await SecureStore.setItemAsync(LMK_KEY, hex, {
      requireAuthentication: false,
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } else {
    webStore.save(LMK_KEY, hex);
  }
}

export async function loadLMK(): Promise<Uint8Array | null> {
  const hex = isNative ? await SecureStore.getItemAsync(LMK_KEY) : webStore.load(LMK_KEY);
  if (!hex) return null;
  return Uint8Array.from(aesjs.utils.hex.toBytes(hex));
}

export async function clearLMK(): Promise<void> {
  if (isNative) {
    await SecureStore.deleteItemAsync(LMK_KEY);
  } else {
    webStore.del(LMK_KEY);
  }
}
