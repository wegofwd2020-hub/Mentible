// Platform I/O for Open Shelves downloads. This module is NOT unit-tested —
// it's a thin wrapper over expo-file-system / the browser download flow,
// verified on-device (plan Task 6). Tests mock `makeIO` wholesale
// (`jest.mock("../downloadIO", () => ({ makeIO: () => ({}) }))`); the real
// logic here just needs to compile and satisfy the `Downloader` interface.
import * as FileSystem from "expo-file-system";
import { Platform } from "react-native";
import type { Downloader } from "./downloadEngine";

const nativeDir = `${FileSystem.documentDirectory}open-shelves-downloads/`;

const nativeIO: Downloader = {
  dir: nativeDir,
  async ensureDir(dir: string): Promise<void> {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  },
  async download(url: string, destPath: string): Promise<{ bytes: number; status?: number }> {
    const res = await FileSystem.downloadAsync(url, destPath);
    const info = await FileSystem.getInfoAsync(destPath);
    return { bytes: (info as any).size ?? 0, status: res.status };
  },
  async move(fromPath: string, toPath: string): Promise<void> {
    await FileSystem.moveAsync({ from: fromPath, to: toPath });
  },
  async remove(path: string): Promise<void> {
    await FileSystem.deleteAsync(path, { idempotent: true });
  },
};

// Hand the URL to the browser, which performs the transfer outside our control.
// Web-only; callers must gate on `supportsOfflineDownloads`.
export function browserDownload(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Web has no in-app offline file store: the browser owns the transfer, so we can
// never report the byte count `downloadEntry` verifies against. Callers MUST NOT
// route a web download through the engine (it would quarantine every success as
// "empty") — branch on `supportsOfflineDownloads` and use `browserDownload`.
// This impl exists only so `makeIO()` satisfies `Downloader` for the delete path,
// where the no-ops are correct: web tracks no files, so there are none to remove.
const webIO: Downloader = {
  dir: "",
  async ensureDir(): Promise<void> {},
  async download(url: string): Promise<{ bytes: number; status?: number }> {
    browserDownload(url);
    return { bytes: 0, status: 0 };
  },
  async move(): Promise<void> {},
  async remove(): Promise<void> {},
};

// Whether this platform can store a download as an in-app offline item.
export const supportsOfflineDownloads = Platform.OS !== "web";

export function makeIO(): Downloader {
  return supportsOfflineDownloads ? nativeIO : webIO;
}
