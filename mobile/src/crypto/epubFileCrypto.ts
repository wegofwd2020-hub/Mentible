import AesGcmCrypto from "react-native-aes-gcm-crypto";
import { bytesToBase64 } from "@/crypto/b64";
import { bare, toHex, fromHex, type SealedEpub } from "@/crypto/epubCrypto";

// ADR-014 Inc 2.1 — EPUB crypto seam, native half. This is the ONLY module in
// the app that imports `react-native-aes-gcm-crypto` (kept out of the web
// bundle by epubFileCrypto.web.ts). @noble is ~0.9 MB/s on Hermes (no JIT) —
// too slow for a 30MB EPUB — so native reads/writes ciphertext file-to-file
// via the OS cipher instead of moving bytes across the JS bridge.
//
// encryptFile(inPath, outPath, base64Key) -> { iv: hex, tag: hex }; writes
// ciphertext-only to outPath (tag returned separately, NOT appended to the
// file) — this is exactly why the wire keeps nonce/tag separate from ct, so
// a book sealed here opens under web's sealEpubBytesWeb/openEpubBytesWeb via
// the same (nonce 12B, tag 16B, ct) triple. Never log dk/nonce/tag.
export async function sealEpubFileNative(
  dk: Uint8Array,
  inUri: string,
  outUri: string
): Promise<SealedEpub> {
  const { iv, tag } = await AesGcmCrypto.encryptFile(bare(inUri), bare(outUri), bytesToBase64(dk));
  return { nonce: fromHex(iv), tag: fromHex(tag) };
}

export async function openEpubFileNative(
  dk: Uint8Array,
  nonce: Uint8Array,
  tag: Uint8Array,
  inUri: string,
  outUri: string
): Promise<void> {
  await AesGcmCrypto.decryptFile(bare(inUri), bare(outUri), bytesToBase64(dk), toHex(nonce), toHex(tag));
}
