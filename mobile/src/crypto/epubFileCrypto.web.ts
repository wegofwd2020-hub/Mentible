import type { SealedEpub } from "@/crypto/epubCrypto";

// Never-called stub: Metro resolves this on web (the base epubFileCrypto.ts
// is the native default, per repo convention — no .native.ts files exist).
// Keeps `react-native-aes-gcm-crypto` out of the web bundle entirely. Web
// callers use sealEpubBytesWeb/openEpubBytesWeb from epubCrypto.ts instead.
const NATIVE_ONLY = "epubFileCrypto is native-only (web uses sealEpubBytesWeb)";

export async function sealEpubFileNative(): Promise<SealedEpub> {
  throw new Error(NATIVE_ONLY);
}

export async function openEpubFileNative(): Promise<void> {
  throw new Error(NATIVE_ONLY);
}
