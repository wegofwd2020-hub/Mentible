import * as DocumentPicker from "expo-document-picker";
import type { PickedAudio } from "@/api/audioUpload";

// Pick an audio file (mp3/m4a/wav) for transcription. Android file providers
// commonly report these as octet-stream, so we allow a broad set plus a
// wildcard fallback to keep the user's file selectable rather than greyed out.
// Returns the normalized asset, or null if the user cancels.
export async function pickAudioFile(): Promise<PickedAudio | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/*", "application/octet-stream", "*/*"],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets || res.assets.length === 0) return null;
  const a = res.assets[0];
  return {
    uri: a.uri,
    name: a.name ?? "audio",
    mimeType: a.mimeType ?? "application/octet-stream",
    size: a.size ?? 0,
  };
}
