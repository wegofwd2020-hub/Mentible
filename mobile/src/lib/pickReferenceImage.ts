import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

export type ReferenceImage = { media_type: string; data: string };

const SAVE_FORMAT: Record<string, ImageManipulator.SaveFormat> = {
  "image/jpeg": ImageManipulator.SaveFormat.JPEG,
  "image/png": ImageManipulator.SaveFormat.PNG,
  "image/webp": ImageManipulator.SaveFormat.WEBP,
};
// ~5 MB raw. Mirrors the backend base64 cap (7_000_000 chars).
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Pick one image from the library, strip its EXIF (re-encode, no transform),
 * and return base64 + media_type. `null` if the user cancels. Throws a
 * friendly Error for an unsupported format or an oversize file. The bytes stay
 * on-device except as the transient reference sent with the post request.
 */
export async function pickReferenceImage(): Promise<ReferenceImage | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error("Photo access is needed to add a reference image.");

  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 1,
  });
  if (res.canceled || !res.assets?.length) return null;

  const asset = res.assets[0];
  const mime = asset.mimeType ?? "";
  if (!SAVE_FORMAT[mime]) throw new Error("Only JPEG, PNG or WebP images are supported.");

  const stripped = await ImageManipulator.manipulateAsync(asset.uri, [], {
    compress: 0.9,
    format: SAVE_FORMAT[mime],
  });

  const info = await FileSystem.getInfoAsync(stripped.uri);
  const bytes = info.exists && typeof info.size === "number" ? info.size : (asset.fileSize ?? 0);
  if (bytes > MAX_BYTES) throw new Error("That image is too large (max 5 MB).");

  const data = await FileSystem.readAsStringAsync(stripped.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return { media_type: mime, data };
}
