import { gcm } from "@noble/ciphers/aes";
import { randomNonce } from "@/crypto/envelope";

// ADR-014 Inc 2.1 — EPUB crypto seam, web/shared half.
//
// Wire format shared with the native half (epubFileCrypto.ts): a platform-
// neutral (nonce 12B, tag 16B, ciphertext-without-tag) triple. @noble's
// gcm(dk, nonce).encrypt() returns ciphertext‖tag(16) — we split the trailing
// tag off so a book sealed on web opens on native and vice versa. Never log
// dk/nonce/tag/ciphertext/plaintext.
export type SealedEpub = { nonce: Uint8Array; tag: Uint8Array };

export function sealEpubBytesWeb(
  dk: Uint8Array,
  bytes: Uint8Array
): { nonce: Uint8Array; tag: Uint8Array; ct: Uint8Array } {
  const nonce = randomNonce();
  const full = gcm(dk, nonce).encrypt(bytes);
  return { nonce, tag: full.slice(-16), ct: full.slice(0, -16) };
}

export function openEpubBytesWeb(
  dk: Uint8Array,
  nonce: Uint8Array,
  tag: Uint8Array,
  ct: Uint8Array
): Uint8Array {
  const full = new Uint8Array(ct.length + tag.length);
  full.set(ct, 0);
  full.set(tag, ct.length);
  return gcm(dk, nonce).decrypt(full); // throws on tamper / wrong key
}

export function bare(uri: string): string {
  return uri.replace(/^file:\/\//, "");
}

export function toHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
