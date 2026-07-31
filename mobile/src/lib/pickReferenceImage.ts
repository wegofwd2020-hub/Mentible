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

// Approx raw byte count of a base64 string (ignores the 1-2 padding chars —
// close enough for a size gate).
function base64Bytes(b64: string): number {
  return Math.floor((b64.length * 3) / 4);
}

/**
 * Pick one image from the library, strip its EXIF (re-encode, no transform ops),
 * and return base64 + media_type. `null` if the user cancels. Throws a friendly
 * Error for an unsupported format or an oversize image.
 *
 * Cross-platform: reads the base64 straight off `manipulateAsync` (works on web
 * via canvas AND native) rather than `expo-file-system`, whose `getInfoAsync` /
 * `readAsStringAsync` are not implemented on web. The re-encode is what strips
 * EXIF/GPS on both platforms. The bytes stay on-device except as the transient
 * reference sent with the post request.
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

  // Empty ops array = format/quality pass only; the re-encode drops EXIF/GPS.
  // base64:true returns the encoded bytes directly — no FileSystem (web-safe).
  const stripped = await ImageManipulator.manipulateAsync(asset.uri, [], {
    compress: 0.9,
    format: SAVE_FORMAT[mime],
    base64: true,
  });

  const data = stripped.base64;
  if (!data) throw new Error("Could not read the selected image.");
  if (base64Bytes(data) > MAX_BYTES) throw new Error("That image is too large (max 5 MB).");

  return { media_type: mime, data };
}
