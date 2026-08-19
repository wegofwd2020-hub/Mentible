import { useEffect, useState } from "react";
import { View, StyleSheet } from "react-native";
import * as FileSystem from "expo-file-system";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Button } from "@/components/ui";
import { spacing } from "@/constants/theme";

interface Props {
  base64: string;
  mime: string; // e.g. "audio/mpeg"
}

// Inline play/pause preview of a narrated-audio derivative (P1-5 P4). Native
// AVPlayer/ExoPlayer support for `data:` URIs is inconsistent across OEMs, so
// this writes the base64 payload to a cache file first (the same technique
// `epubLibrary.ts`'s native `downloadArtifact` path already uses — see
// mobile/src/storage/epubLibrary.ts:75-79) and plays that file:// URI —
// never a data: URI. See the sibling `AudioNarrationPlayer.web.tsx` (a plain
// <audio> element) for the web path, which has no such concern.
export function AudioNarrationPlayer({ base64, mime }: Props) {
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [writeError, setWriteError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFileUri(null);
    setWriteError(false);
    const ext = mime === "audio/mpeg" ? "mp3" : "audio";
    const path = `${FileSystem.cacheDirectory}narration-preview.${ext}`;
    FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 })
      .then(() => {
        if (!cancelled) setFileUri(path);
      })
      .catch(() => {
        if (!cancelled) setWriteError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [base64, mime]);

  // Fail-open: if the file write fails, no playback preview — posts.tsx
  // still renders the Download button unconditionally alongside this.
  if (writeError || !fileUri) return null;
  return <AudioNarrationPlayerLoaded uri={fileUri} />;
}

function AudioNarrationPlayerLoaded({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  return (
    <View style={styles.row}>
      <Button
        variant="ghost"
        label={status.playing ? "Pause" : "Play"}
        onPress={() => (status.playing ? player.pause() : player.play())}
        accessibilityLabel={status.playing ? "Pause narration" : "Play narration"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", marginTop: spacing.xs },
});
