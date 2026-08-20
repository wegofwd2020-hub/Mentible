import { gcm } from "@noble/ciphers/aes";
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha2";
import * as Crypto from "expo-crypto";

// ADR-014 D10 — zero-knowledge library sync crypto envelope.
//
// This module is the ONLY thing in the app that can read plaintext. All
// key/nonce/salt material comes from expo-crypto's CSPRNG (real randomness on
// web AND Hermes — verified in largeSecureStore.ts). NEVER Math.random here.
// The recovery key / KEK / LMK / DK / plaintext must NEVER be logged.
export function randomBytes(n: number): Uint8Array { return Crypto.getRandomBytes(n); }
export function randomNonce(): Uint8Array { return randomBytes(12); }   // GCM 96-bit nonce
export function randomSalt(): Uint8Array { return randomBytes(16); }
export function generateKey(): Uint8Array { return randomBytes(32); }   // AES-256 key

// Recovery key: 32 bytes of entropy → base32-ish groups the user copies once.
const B32 = "abcdefghjkmnpqrstuvwxyz23456789"; // no ambiguous chars
export function generateRecoveryKey(): string {
  const b = randomBytes(20);
  let s = "";
  for (let i = 0; i < b.length; i++) { s += B32[b[i] % B32.length]; if (i % 4 === 3 && i < b.length - 1) s += "-"; }
  return s; // e.g. "k7m2-9ab3-..." — high-entropy, human-copyable
}

export function deriveKEK(recoveryKey: string, salt: Uint8Array): Uint8Array {
  return pbkdf2(sha256, new TextEncoder().encode(recoveryKey), salt, { c: 100_000, dkLen: 32 });
}

export function seal(key: Uint8Array, bytes: Uint8Array): { nonce: Uint8Array; ct: Uint8Array } {
  const nonce = randomNonce();
  return { nonce, ct: gcm(key, nonce).encrypt(bytes) };
}
export function open(key: Uint8Array, nonce: Uint8Array, ct: Uint8Array): Uint8Array {
  return gcm(key, nonce).decrypt(ct); // throws on auth failure (tamper / wrong key)
}

const enc = new TextEncoder(), dec = new TextDecoder();
export function encryptBook(bookJson: string, dk: Uint8Array) { return seal(dk, enc.encode(bookJson)); }
export function decryptBook(nonce: Uint8Array, ct: Uint8Array, dk: Uint8Array): string { return dec.decode(open(dk, nonce, ct)); }
