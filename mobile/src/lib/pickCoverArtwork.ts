import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

// Cover artwork is drawn full-bleed on the cover page. Resize to the cover's
// own width so the stored book JSON stays small, and re-encode so EXIF/GPS
// location data is dropped on both platforms.
export const COVER_ARTWORK_WIDTH = 1600;
// Raw-byte cap on the picked image (matches the reference-image limit).
export const COVER_ARTWORK_MAX_BYTES = 5 * 1024 * 1024;

function base64Bytes(b64: string): number {
  return Math.floor((b64.length * 3) / 4);
}

/**
 * Let the user pick cover artwork from the library. Returns a `data:` URI, or
 * `null` if the user cancels. Throws a friendly Error for permission denial,
 * an unsupported format, or an oversize image.
 */
export async function pickCoverArtwork(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error("Photo access is needed to choose cover artwork.");

  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 1,
  });
  if (res.canceled || !res.assets?.length) return null;

  const asset = res.assets[0];
  const mime = asset.mimeType ?? "";
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
    throw new Error("Only JPEG, PNG or WebP images are supported.");
  }

  // Resize keeps the aspect ratio; re-encoding as JPEG drops EXIF/GPS.
  const out = await ImageManipulator.manipulateAsync(
    asset.uri,
    [{ resize: { width: COVER_ARTWORK_WIDTH } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  const data = out.base64;
  if (!data) throw new Error("Could not read the selected image.");
  if (base64Bytes(data) > COVER_ARTWORK_MAX_BYTES) {
    throw new Error("That image is too large (max 5 MB).");
  }
  return `data:image/jpeg;base64,${data}`;
}
