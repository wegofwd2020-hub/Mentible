// Presentational entry detail with provenance (spec P0-7). Plaintext fields; the
// screen owns loading + opening the source link. Rights are surfaced verbatim and
// "Not stated by source" when absent — never fabricated.
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/constants/theme";
import type { FeedEntry } from "./types";

// "browser" = the web path: the browser took the file, we did not store it (see downloadIO).
export type DownloadState = "idle" | "downloading" | "done" | "browser" | "error";

interface Props {
  entry: FeedEntry;
  sourceTitle: string;
  onViewAtSource: (url: string) => void;
  canDownload?: boolean;
  onDownload?: () => void;
  downloadState?: DownloadState;
  downloadError?: string | null;
}

const LABEL: Record<DownloadState, string> = {
  idle: "Download",
  downloading: "Downloading…",
  done: "Downloaded",
  browser: "Download again",
  error: "Try again",
};

const STATUS: Partial<Record<DownloadState, string>> = {
  done: "Saved on this device. Manage or delete it under Downloads.",
  browser: "Sent to your browser's downloads. Web downloads are not stored in the app for offline reading.",
};

export function EntryDetail({
  entry,
  sourceTitle,
  onViewAtSource,
  canDownload = false,
  onDownload,
  downloadState = "idle",
  downloadError = null,
}: Props) {
  const busy = downloadState === "downloading";

  return (
    <View style={styles.wrap}>
      {entry.coverUrl ? (
        <Image source={{ uri: entry.coverUrl }} style={styles.cover} resizeMode="contain" />
      ) : null}
      <Text style={styles.title}>{entry.title}</Text>
      {entry.authors.length > 0 ? <Text style={styles.author}>{entry.authors.join(", ")}</Text> : null}
      <Text style={styles.badge}>{entry.mediaType}</Text>
      {entry.summary ? <Text style={styles.summary}>{entry.summary}</Text> : null}

      {canDownload ? (
        <View style={styles.download}>
          <Pressable
            testID="download-entry"
            style={[styles.button, busy && styles.buttonBusy]}
            disabled={busy}
            onPress={onDownload}
          >
            <Text style={styles.buttonText}>{LABEL[downloadState]}</Text>
          </Pressable>
          {STATUS[downloadState] ? <Text style={styles.note}>{STATUS[downloadState]}</Text> : null}
          {downloadState === "error" && downloadError ? <Text style={styles.error}>{downloadError}</Text> : null}
        </View>
      ) : null}

      <View style={styles.provenance}>
        <Text style={styles.provTitle}>Provenance</Text>
        <Text style={styles.provLine}>Source: {sourceTitle}</Text>
        <Text style={styles.provLine}>Rights: {entry.rightsText ?? "Not stated by source"}</Text>
        {entry.canonicalUrl ? (
          <Pressable testID="view-at-source" style={styles.button} onPress={() => onViewAtSource(entry.canonicalUrl as string)}>
            <Text style={styles.buttonText}>View at source</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  cover: { width: "100%", height: 220, borderRadius: radius.md, backgroundColor: colors.border },
  title: { color: colors.text, fontSize: typography.sizeXxl, fontWeight: "700" },
  author: { color: colors.textMuted, fontSize: typography.sizeMd },
  badge: { color: colors.textMuted, fontSize: typography.sizeXs },
  summary: { color: colors.text, fontSize: typography.sizeMd, marginTop: spacing.sm },
  download: { marginTop: spacing.md, gap: spacing.xs },
  buttonBusy: { opacity: 0.6 },
  note: { color: colors.textMuted, fontSize: typography.sizeSm },
  error: { color: colors.error, fontSize: typography.sizeSm },
  provenance: { marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: spacing.xs },
  provTitle: { color: colors.text, fontSize: typography.sizeMd, fontWeight: "600" },
  provLine: { color: colors.textMuted, fontSize: typography.sizeSm },
  button: { marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: "center" },
  buttonText: { color: colors.primaryText, fontSize: typography.sizeMd, fontWeight: "600" },
});
