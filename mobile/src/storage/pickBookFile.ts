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
