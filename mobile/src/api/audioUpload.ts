import { Platform } from "react-native";

// A picked audio file, normalized from an expo-document-picker asset.
export interface PickedAudio {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface AudioFormFields {
  language: string;
  title?: string;
  providerId?: string;
  apiKey?: string;
}

// Build the multipart body for POST /api/v1/trust/projects/{id}/transcribe.
//
// The file part differs by platform: on native the picked uri is a `file://`
// path that RN's FormData streams from a `{uri,name,type}` object; on web the
// uri is a blob/data URL we must `fetch()` into a Blob and append as a File.
// NEVER import expo-file-system here — it is native-only and breaks the web
// build (a known repo trap).
//
// `language` is always sent; `title`/`provider_id`/`api_key` are appended only
// when defined, so omitting them lets the backend fall back to the managed
// default STT provider.
export async function buildAudioForm(asset: PickedAudio, fields: AudioFormFields): Promise<FormData> {
  const form = new FormData();
  if (Platform.OS === "web") {
    const blob = await (await fetch(asset.uri)).blob();
    form.append("file", blob, asset.name);
  } else {
    form.append("file", { uri: asset.uri, name: asset.name, type: asset.mimeType } as unknown as Blob);
  }
  form.append("language", fields.language);
  if (fields.title) form.append("title", fields.title);
  if (fields.providerId) form.append("provider_id", fields.providerId);
  if (fields.apiKey) form.append("api_key", fields.apiKey);
  return form;
}
