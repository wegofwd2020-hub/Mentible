import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { providerInfo } from "@/constants/providers";

// Per-provider BYOK keys (Phase 3b). Anthropic keeps the original storage key so
// existing installs need no migration; other providers are namespaced. The
// provider id matches the backend registry / GenerationParams.provider.
const LEGACY_ANTHROPIC_KEY = "sbq_byok_key";

function storageKey(provider: string): string {
  return provider === "anthropic" ? LEGACY_ANTHROPIC_KEY : `sbq_byok_key_${provider}`;
}

const isNative = Platform.OS !== "web";

// Web fallback: localStorage is not as secure as the Android Keystore but is
// sufficient for browser-based development and testing. The real target is
// Android (D3); web support here exists purely for the Expo web preview.
const webStore = {
  save: (key: string, value: string) => localStorage.setItem(key, value),
  load: (key: string) => localStorage.getItem(key),
  del:  (key: string) => localStorage.removeItem(key),
};

export async function saveApiKey(apiKey: string, provider = "anthropic"): Promise<void> {
  const key = storageKey(provider);
  if (isNative) {
    await SecureStore.setItemAsync(key, apiKey, {
      requireAuthentication: false,
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } else {
    webStore.save(key, apiKey);
  }
}

export async function loadApiKey(provider = "anthropic"): Promise<string | null> {
  const key = storageKey(provider);
  if (isNative) return SecureStore.getItemAsync(key);
  return webStore.load(key);
}

export async function deleteApiKey(provider = "anthropic"): Promise<void> {
  const key = storageKey(provider);
  if (isNative) {
    await SecureStore.deleteItemAsync(key);
  } else {
    webStore.del(key);
  }
}

// Show only the provider prefix + last 4. The displayed prefix comes from the
// provider's registry entry (anthropic sk-ant-, openai sk-, groq gsk_, gemini "").
export function maskApiKey(apiKey: string, provider = "anthropic"): string {
  const prefix = providerInfo(provider).keyPrefix;
  if (apiKey.length < 8) return `${prefix}...????`;
  return `${prefix}...${apiKey.slice(-4)}`;
}

// Client-side shape check (the backend re-validates per provider). Each provider
// declares its key prefix; an empty prefix (e.g. Gemini's AIza… keys) means a
// length-only check.
export function isValidApiKey(value: string, provider = "anthropic"): boolean {
  const prefix = providerInfo(provider).keyPrefix;
  return value.startsWith(prefix) && value.length >= 20;
}
