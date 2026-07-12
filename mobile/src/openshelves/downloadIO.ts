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

// Web has no in-app offline file store: `download` hands the URL to the
// browser (which performs its own download outside our control) and we
// report 0 bytes tracked on our side. move/remove/ensureDir are no-ops.
const webIO: Downloader = {
  dir: "",
  async ensureDir(): Promise<void> {},
  async download(url: string): Promise<{ bytes: number; status?: number }> {
    const a = document.createElement("a");
    a.href = url;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return { bytes: 0, status: 0 };
  },
  async move(): Promise<void> {},
  async remove(): Promise<void> {},
};

export function makeIO(): Downloader {
  return Platform.OS === "web" ? webIO : nativeIO;
}
