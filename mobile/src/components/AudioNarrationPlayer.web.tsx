import React from "react";

interface Props {
  base64: string;
  mime: string;
}

// Web path for the P1-5 P4 audio-narration preview. Unlike native
// (AudioNarrationPlayer.tsx — inconsistent data: URI support in
// AVPlayer/ExoPlayer, so it writes a cache file first), every browser's
// native <audio> element plays a data: URI directly, so no expo-audio /
// file-write dance is needed here at all.
export function AudioNarrationPlayer({ base64, mime }: Props) {
  return React.createElement("audio", {
    controls: true,
    src: `data:${mime};base64,${base64}`,
    style: { width: "100%", marginTop: 4 },
  });
}
