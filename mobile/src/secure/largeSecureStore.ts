import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as aesjs from "aes-js";

// Storage adapter for the Supabase session (ADR-014 D1). The session can exceed
// expo-secure-store's ~2KB value limit, so we encrypt it (AES-CTR) and keep the
// CIPHERTEXT in AsyncStorage; the per-key AES key lives in expo-secure-store
// (hardware-backed). The protecting secret is therefore in secure storage — D1 —
// without hitting the size cap. This is Supabase's recommended RN pattern.
//
// The session JWT is OUR identity token, never a BYOK/LLM key (CLAUDE.md).
class LargeSecureStore {
  private async encrypt(key: string, value: string): Promise<string> {
    const encryptionKey = Crypto.getRandomBytes(256 / 8); // 32-byte AES-256 key
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const ciphertext = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));
    return aesjs.utils.hex.fromBytes(ciphertext);
  }

  private async decrypt(key: string, ciphertextHex: string): Promise<string | null> {
    const encryptionKeyHex = await SecureStore.getItemAsync(key);
    if (!encryptionKeyHex) return null; // key gone → can't recover; treat as absent
    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(encryptionKeyHex),
      new aesjs.Counter(1),
    );
    const plaintext = cipher.decrypt(aesjs.utils.hex.toBytes(ciphertextHex));
    return aesjs.utils.utf8.fromBytes(plaintext);
  }

  async getItem(key: string): Promise<string | null> {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) return null;
    return this.decrypt(key, encrypted);
  }

  async setItem(key: string, value: string): Promise<void> {
    const encrypted = await this.encrypt(key, value);
    await AsyncStorage.setItem(key, encrypted);
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }
}

export const largeSecureStore = new LargeSecureStore();
