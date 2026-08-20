// Covers the Backup & Restore whole-branch review's Important finding: on
// native, saveBackupFile wrote the backup to documentDirectory but never
// shared it, so the file was invisible to the user. Mirrors the
// expo-sharing usage in epubLibrary.ts's nativeOpen (isAvailableAsync guard
// + shareAsync), but degrades gracefully instead of throwing when sharing
// is unavailable — the file is still written either way.

const mockDownloadArtifact = jest.fn();
jest.mock("@/storage/epubLibrary", () => ({
  downloadArtifact: (...a: any[]) => mockDownloadArtifact(...a),
}));

const mockIsAvailableAsync = jest.fn(async (..._a: any[]) => true);
const mockShareAsync = jest.fn(async (..._a: any[]) => {});
jest.mock("expo-sharing", () => ({
  isAvailableAsync: (...a: any[]) => mockIsAvailableAsync(...a),
  shareAsync: (...a: any[]) => mockShareAsync(...a),
}));

// Platform.OS is mutated per-test (jest-expo's react-native mock allows it).
import { Platform } from "react-native";
import { saveBackupFile } from "@/lib/backupFile";

beforeEach(() => {
  mockDownloadArtifact.mockClear();
  mockIsAvailableAsync.mockClear().mockResolvedValue(true);
  mockShareAsync.mockClear();
});

afterEach(() => {
  (Platform as any).OS = "ios";
});

it("native: shares the saved backup file via the OS share sheet", async () => {
  (Platform as any).OS = "android";
  mockDownloadArtifact.mockResolvedValueOnce({ savedPath: "file:///doc/x.mentible-backup" });
  const bytes = new Uint8Array([1, 2, 3]);

  await saveBackupFile(bytes, "x.mentible-backup");

  expect(mockDownloadArtifact).toHaveBeenCalledWith(
    expect.anything(),
    "x.mentible-backup",
    "application/zip",
  );
  expect(mockIsAvailableAsync).toHaveBeenCalled();
  expect(mockShareAsync).toHaveBeenCalledWith(
    "file:///doc/x.mentible-backup",
    expect.objectContaining({ mimeType: "application/zip" }),
  );
});

it("web: does not attempt to share (downloadArtifact already triggered the browser download)", async () => {
  (Platform as any).OS = "web";
  mockDownloadArtifact.mockResolvedValueOnce({});
  const bytes = new Uint8Array([1, 2, 3]);

  await saveBackupFile(bytes, "x.mentible-backup");

  expect(mockShareAsync).not.toHaveBeenCalled();
});

it("native: does not throw when sharing is unavailable — the file is still written", async () => {
  (Platform as any).OS = "android";
  mockIsAvailableAsync.mockResolvedValueOnce(false);
  mockDownloadArtifact.mockResolvedValueOnce({ savedPath: "file:///doc/x.mentible-backup" });
  const bytes = new Uint8Array([1, 2, 3]);

  await expect(saveBackupFile(bytes, "x.mentible-backup")).resolves.toBeDefined();
  expect(mockShareAsync).not.toHaveBeenCalled();
});
