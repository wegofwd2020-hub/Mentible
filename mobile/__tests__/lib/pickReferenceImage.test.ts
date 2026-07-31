import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { pickReferenceImage } from "@/lib/pickReferenceImage";

jest.mock("expo-image-picker");
jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" },
  manipulateAsync: jest.fn(),
}));

const IP = ImagePicker as jest.Mocked<typeof ImagePicker>;
const IM = ImageManipulator as jest.Mocked<typeof ImageManipulator>;

// A base64 string ~n raw bytes (length ≈ n * 4/3).
const b64OfBytes = (n: number) => "A".repeat(Math.ceil((n * 4) / 3));

beforeEach(() => {
  jest.clearAllMocks();
  (IP as any).MediaTypeOptions = { Images: "Images" };
  IP.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true } as any);
});

test("returns null when the user cancels", async () => {
  IP.launchImageLibraryAsync.mockResolvedValue({ canceled: true } as any);
  expect(await pickReferenceImage()).toBeNull();
});

test("strips EXIF and returns base64 + media_type (no FileSystem — web-safe)", async () => {
  IP.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file://x.png", mimeType: "image/png", fileSize: 1000 }],
  } as any);
  // The helper reads base64 straight off the manipulate result (works on web).
  IM.manipulateAsync.mockResolvedValue({ uri: "file://stripped.png", base64: "BASE64DATA" } as any);

  const out = await pickReferenceImage();
  expect(out).toEqual({ media_type: "image/png", data: "BASE64DATA" });
  // EXIF strip ran (no transform ops) AND base64 was requested from the encoder.
  expect(IM.manipulateAsync).toHaveBeenCalledWith(
    "file://x.png",
    [],
    expect.objectContaining({ base64: true }),
  );
});

test("throws if the encoder returns no base64", async () => {
  IP.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file://x.png", mimeType: "image/png" }],
  } as any);
  IM.manipulateAsync.mockResolvedValue({ uri: "file://stripped.png" } as any); // no base64

  await expect(pickReferenceImage()).rejects.toThrow(/could not read/i);
});

test("rejects an unsupported format", async () => {
  IP.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file://x.gif", mimeType: "image/gif", fileSize: 10 }],
  } as any);
  await expect(pickReferenceImage()).rejects.toThrow(/JPEG, PNG or WebP/);
});

test("rejects an oversize image (by stripped base64 length)", async () => {
  IP.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file://x.png", mimeType: "image/png" }],
  } as any);
  // Stripped output is ~6 MB → over the 5 MB cap.
  IM.manipulateAsync.mockResolvedValue({
    uri: "file://stripped.png",
    base64: b64OfBytes(6 * 1024 * 1024),
  } as any);

  await expect(pickReferenceImage()).rejects.toThrow(/too large/i);
});
