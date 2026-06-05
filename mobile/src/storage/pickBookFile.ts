import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { Platform } from "react-native";

// Read a picked asset's text. Reading differs by platform: on web the picked
// asset uri is a blob/data URL (read with fetch); on native it's a file uri
// (read with expo-file-system).
async function readPickedText(uri: string): Promise<string> {
  if (Platform.OS === "web") {
    const r = await fetch(uri);
    return await r.text();
  }
  return await FileSystem.readAsStringAsync(uri);
}

// Show the document picker for the given MIME type(s) and return the chosen
// file's text contents, or null if the user cancels.
async function pickFileContents(type: string | string[]): Promise<string | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type,
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (res.canceled || !res.assets || res.assets.length === 0) return null;
  return readPickedText(res.assets[0].uri);
}

// Pick a .json file and return its text contents, or null if the user cancels.
// Used by the import screen for books too large to paste (e.g. a migrated
// "Everything"-scope book is ~1.5 MB). Pairs with importBook() in importBook.ts.
export async function pickBookFileContents(): Promise<string | null> {
  return pickFileContents("application/json");
}

// Pick a Markdown/plain-text file and return its contents, or null if the user
// cancels. Used by the New book screen to load a table of contents from a file
// instead of pasting it. Markdown has no universal MIME and Android file
// providers commonly report `.md` as text/plain or application/octet-stream —
// so we allow a broad set (plus a wildcard fallback) to keep the user's `.md`
// selectable rather than greyed out in the picker.
export async function pickTocFileContents(): Promise<string | null> {
  return pickFileContents([
    "text/markdown",
    "text/x-markdown",
    "text/plain",
    "application/octet-stream",
    "*/*",
  ]);
}

// base64 → ArrayBuffer. Hermes has no atob, so decode with a small accumulator.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function fromBase64(s: string): ArrayBuffer {
  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) lookup[B64.charCodeAt(i)] = i;
  const clean = s.replace(/[^A-Za-z0-9+/]/g, ""); // drop padding/newlines
  const out = new Uint8Array((clean.length * 6) >> 3); // floor(n*6/8)
  let p = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    acc = (acc << 6) | lookup[clean.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (acc >> bits) & 0xff;
    }
  }
  return out.buffer;
}

// Pick an .epub file and return its bytes + filename, or null if cancelled.
// EPUB is application/epub+zip, but Android providers often report it as
// octet-stream, so allow a broad set (plus a wildcard) to keep it selectable.
export async function pickEpubFile(): Promise<{ name: string; bytes: ArrayBuffer } | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ["application/epub+zip", "application/octet-stream", "*/*"],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets || res.assets.length === 0) return null;
  const asset = res.assets[0];
  const name = asset.name ?? "book.epub";
  let bytes: ArrayBuffer;
  if (Platform.OS === "web") {
    bytes = await (await fetch(asset.uri)).arrayBuffer();
  } else {
    const b64 = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    bytes = fromBase64(b64);
  }
  return { name, bytes };
}
