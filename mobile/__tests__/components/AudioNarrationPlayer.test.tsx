import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AudioNarrationPlayer } from "@/components/AudioNarrationPlayer";

jest.mock("expo-file-system", () => ({
  __esModule: true,
  cacheDirectory: "file:///cache/",
  EncodingType: { Base64: "base64" },
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
}));

const mockPlayer = { play: jest.fn(), pause: jest.fn() };
let mockStatus = { playing: false };
jest.mock("expo-audio", () => ({
  useAudioPlayer: jest.fn(() => mockPlayer),
  useAudioPlayerStatus: jest.fn(() => mockStatus),
}));

import * as FileSystem from "expo-file-system";
import { useAudioPlayer } from "expo-audio";

beforeEach(() => {
  jest.clearAllMocks();
  mockStatus = { playing: false };
});

it("writes the base64 payload to a cache file, then plays that file:// URI", async () => {
  render(<AudioNarrationPlayer base64="AAAA" mime="audio/mpeg" />);
  await waitFor(() =>
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
      "file:///cache/narration-preview.mp3",
      "AAAA",
      { encoding: "base64" },
    ),
  );
  expect(await screen.findByLabelText("Play narration")).toBeTruthy();
  expect(useAudioPlayer).toHaveBeenCalledWith("file:///cache/narration-preview.mp3");
});

it("pressing Play calls player.play()", async () => {
  render(<AudioNarrationPlayer base64="AAAA" mime="audio/mpeg" />);
  fireEvent.press(await screen.findByLabelText("Play narration"));
  expect(mockPlayer.play).toHaveBeenCalledTimes(1);
});

it("shows Pause and calls player.pause() while playing", async () => {
  mockStatus = { playing: true };
  render(<AudioNarrationPlayer base64="AAAA" mime="audio/mpeg" />);
  const btn = await screen.findByLabelText("Pause narration");
  fireEvent.press(btn);
  expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
});

it("fails open (renders nothing) when the cache write fails", async () => {
  (FileSystem.writeAsStringAsync as jest.Mock).mockRejectedValueOnce(new Error("disk full"));
  render(<AudioNarrationPlayer base64="AAAA" mime="audio/mpeg" />);
  await waitFor(() => expect(FileSystem.writeAsStringAsync).toHaveBeenCalled());
  expect(screen.queryByLabelText("Play narration")).toBeNull();
});
