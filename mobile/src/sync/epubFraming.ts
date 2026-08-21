// Wire framing for a synced EPUB body: a 4-byte big-endian meta length, then the
// meta ciphertext, then the epub ciphertext. Matches the backend's split
// (int.from_bytes(body[:4],"big")). Keeps the (large) meta ciphertext out of an
// HTTP header — it rides in this body.

export function packEpubBody(metaCt: Uint8Array, epubCt: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + metaCt.length + epubCt.length);
  new DataView(out.buffer).setUint32(0, metaCt.length, false); // big-endian
  out.set(metaCt, 4);
  out.set(epubCt, 4 + metaCt.length);
  return out;
}

export function unpackEpubBody(body: Uint8Array): { metaCt: Uint8Array; epubCt: Uint8Array } {
  if (body.length < 4) throw new Error("epub body too short");
  const metaLen = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0, false);
  if (4 + metaLen > body.length) throw new Error("epub body: meta_len exceeds body");
  return { metaCt: body.slice(4, 4 + metaLen), epubCt: body.slice(4 + metaLen) };
}
