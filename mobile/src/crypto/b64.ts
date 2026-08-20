// Pure-JS base64 <-> bytes for the sync wire boundary (syncClient.ts). Hermes
// has no global btoa/atob, and web's btoa/atob are latin1-only (mangle raw
// bytes above 0x7f) — so this is a small dependency-light accumulator that
// works identically on both, mirroring the decode shape already used by
// `storage/pickBookFile.ts#fromBase64` (kept separate: that one returns an
// ArrayBuffer for file-picker callers, this one is byte<->string only).
const B64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      B64_CHARS[(n >> 18) & 0x3f] +
      B64_CHARS[(n >> 12) & 0x3f] +
      B64_CHARS[(n >> 6) & 0x3f] +
      B64_CHARS[n & 0x3f];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const n = bytes[i] << 16;
    out += B64_CHARS[(n >> 18) & 0x3f] + B64_CHARS[(n >> 12) & 0x3f] + "==";
  } else if (remaining === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out +=
      B64_CHARS[(n >> 18) & 0x3f] +
      B64_CHARS[(n >> 12) & 0x3f] +
      B64_CHARS[(n >> 6) & 0x3f] +
      "=";
  }
  return out;
}

export function base64ToBytes(s: string): Uint8Array {
  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64_CHARS.length; i++) lookup[B64_CHARS.charCodeAt(i)] = i;
  const clean = s.replace(/[^A-Za-z0-9+/]/g, ""); // drop padding/newlines
  const out = new Uint8Array((clean.length * 6) >> 3); // floor(n*6/8)
  let p = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = lookup[clean.charCodeAt(i)];
    if (v === -1) continue; // defensive: charset already filtered above
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}
