// Cross-platform file glue for the Backup & Restore feature (backup-restore
// plan, Task 4). Pairs with buildBackup()/restoreBackup() in
// @/storage/backupRestore, which only produce/consume raw bytes — getting
// those bytes to/from an actual file is platform-specific and lives here.

import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { Platform } from "react-native";
import { downloadArtifact } from "@/storage/epubLibrary";
import { fromBase64 } from "@/storage/pickBookFile";

// Deliver a backup archive to the user: a browser download on web, a file in
// documentDirectory on native (see downloadArtifact in epubLibrary.ts, which
// already handles both). Slice to a fresh, zero-offset buffer first — a
// Uint8Array's `.buffer` isn't guaranteed to start at byte 0 of its
// underlying ArrayBuffer (see ExportBookJsonButton.tsx for the same guard).
export async function saveBackupFile(
  bytes: Uint8Array,
  filename: string,
): Promise<{ savedPath?: string }> {
  return downloadArtifact(bytes.slice().buffer, filename, "application/zip");
}

// Pick a backup file and return its raw bytes, or null if the user cancels.
export async function pickBackupFile(): Promise<Uint8Array | null> {
  if (Platform.OS === "web") {
    return pickBackupFileWeb();
  }
  return pickBackupFileNative();
}

// Native: mirrors pickBookFile.ts's DocumentPicker + base64-read pattern
// exactly (readPickedBytes / pickBookBundleContents) — `.mentible-backup`
// has no registered MIME, so Android/most providers report it as
// octet-stream, hence the broad type list + wildcard fallback.
async function pickBackupFileNative(): Promise<Uint8Array | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ["application/zip", "application/octet-stream", "*/*"],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets || res.assets.length === 0) return null;
  const b64 = await FileSystem.readAsStringAsync(res.assets[0].uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return new Uint8Array(fromBase64(b64));
}

// Web: there's no native "open" dialog, so drive a programmatic, invisible
// `<input type="file">` — the standard web workaround (mirrors the download
// side's programmatic `<a download>` in epubLibrary.ts's downloadArtifact).
function pickBackupFileWeb(): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".mentible-backup,application/zip,application/octet-stream";
    input.style.display = "none";
    input.onchange = () => {
      const file = input.files && input.files[0];
      document.body.removeChild(input);
      if (!file) {
        resolve(null);
        return;
      }
      file
        .arrayBuffer()
        .then((buf) => resolve(new Uint8Array(buf)))
        .catch(() => resolve(null));
    };
    document.body.appendChild(input);
    input.click();
  });
}
