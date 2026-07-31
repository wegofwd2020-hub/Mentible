import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system";
import { pickReferenceImage } from "@/lib/pickReferenceImage";

jest.mock("expo-image-picker");
jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" },
  manipulateAsync: jest.fn(),
}));
jest.mock("expo-file-system", () => ({
  EncodingType: { Base64: "base64" },
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
}));

const IP = ImagePicker as jest.Mocked<typeof ImagePicker>;
const IM = ImageManipulator as jest.Mocked<typeof ImageManipulator>;
const FS = FileSystem as jest.Mocked<typeof FileSystem>;

beforeEach(() => {
  jest.clearAllMocks();
  (IP as any).MediaTypeOptions = { Images: "Images" };
  IP.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true } as any);
});

test("returns null when the user cancels", async () => {
  IP.launchImageLibraryAsync.mockResolvedValue({ canceled: true } as any);
  expect(await pickReferenceImage()).toBeNull();
});

test("strips EXIF and returns base64 + media_type", async () => {
  IP.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file://x.png", mimeType: "image/png", fileSize: 1000 }],
  } as any);
  IM.manipulateAsync.mockResolvedValue({ uri: "file://stripped.png" } as any);
  FS.getInfoAsync.mockResolvedValue({ exists: true, size: 1000 } as any);
  FS.readAsStringAsync.mockResolvedValue("BASE64DATA");

  const out = await pickReferenceImage();
  expect(out).toEqual({ media_type: "image/png", data: "BASE64DATA" });
  // EXIF strip ran (no transform ops).
  expect(IM.manipulateAsync).toHaveBeenCalledWith("file://x.png", [], expect.any(Object));
  // Verify metadata and base64 are read from the STRIPPED uri, not the original.
  expect(FS.getInfoAsync).toHaveBeenCalledWith("file://stripped.png");
  expect(FS.readAsStringAsync).toHaveBeenCalledWith("file://stripped.png", expect.any(Object));
});

test("rejects an unsupported format", async () => {
  IP.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file://x.gif", mimeType: "image/gif", fileSize: 10 }],
  } as any);
  await expect(pickReferenceImage()).rejects.toThrow(/JPEG, PNG or WebP/);
});

test("rejects an oversize image", async () => {
  IP.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file://x.png", mimeType: "image/png", fileSize: 6 * 1024 * 1024 }],
  } as any);
  IM.manipulateAsync.mockResolvedValue({ uri: "file://stripped.png" } as any);
  FS.getInfoAsync.mockResolvedValue({ exists: true, size: 6 * 1024 * 1024 } as any);

  await expect(pickReferenceImage()).rejects.toThrow(/too large/i);
});
