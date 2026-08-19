// Book-level batch narration control (ADR-040 rung 4, Task 3). Narrates every
// content-bearing topic that doesn't already carry an audio clip, sequentially,
// via useGenerateAllNarration — the same client-orchestrated shape as
// useGenerateAll's "Generate all topics" (app/book/generate/[id].tsx), but
// calling generateAndStoreTopicAudio per topic instead of submitGenerate.
// Mounted on the book home/studio screen (app/book/saved/[id].tsx) next to the
// "Generate all topics" entry, wherever the book is in scope and editable.

import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { Book } from "@/types/book";
import {
  useGenerateAllNarration,
  type NarrationProgress,
} from "@/hooks/useGenerateAllNarration";
import { loadApiKey } from "@/secure/keyStore";
import { saveBook } from "@/storage/bookStore";
import { spacing, typography, radius, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

const STATUS_GLYPH: Record<NarrationProgress["status"], string> = {
  pending: "○",
  generating: "…",
  done: "✓",
  failed: "✕",
};

function NarrationRow({ item, theme }: { item: NarrationProgress; theme: ReturnType<typeof useTheme> }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row} accessibilityLabel={`${item.title} — ${item.status}`}>
      <Text style={[styles.glyph, styles[`glyph_${item.status}`]]}>
        {item.status === "generating" ? "" : STATUS_GLYPH[item.status]}
      </Text>
      {item.status === "generating" && (
        <ActivityIndicator size="small" color={theme.primary} style={styles.spinner} />
      )}
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {item.title}
        </Text>
        {item.status === "failed" && item.error && (
          <Text style={styles.rowError} numberOfLines={2}>
            {item.error}
          </Text>
        )}
      </View>
    </View>
  );
}

export function GenerateAllNarration({
  book,
  onBookChange,
}: {
  book: Book;
  onBookChange: (book: Book) => void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  const getApiKey = React.useCallback(() => loadApiKey("openai"), []);
  const handleBookChange = React.useCallback(
    async (next: Book) => {
      await saveBook(next);
      onBookChange(next);
    },
    [onBookChange],
  );

  const { progress, running, finished, doneCount, failedCount, total, errorMsg, start, cancel } =
    useGenerateAllNarration({ book, getApiKey, onBookChange: handleBookChange });

  if (total === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>Narration</Text>
        <Text style={styles.summary}>
          {doneCount}/{total} narrated
          {failedCount > 0 ? ` · ${failedCount} failed` : ""}
        </Text>
      </View>

      {errorMsg && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{errorMsg}</Text>
        </View>
      )}

      {!running ? (
        <Pressable
          style={[styles.actionBtn, doneCount >= total && styles.actionBtnDisabled]}
          onPress={start}
          disabled={doneCount >= total}
          accessibilityRole="button"
          accessibilityLabel={
            doneCount > 0 ? "Generate remaining narration" : "Generate all narration"
          }
        >
          <Text style={styles.actionBtnText}>
            {doneCount >= total
              ? "All topics narrated"
              : doneCount > 0
                ? "Generate remaining narration"
                : "Generate all narration"}
          </Text>
        </Pressable>
      ) : (
        <Pressable
          style={[styles.actionBtn, styles.cancelBtn]}
          onPress={cancel}
          accessibilityRole="button"
          accessibilityLabel="Stop narrating"
        >
          <Text style={styles.cancelBtnText}>
            Stop ({doneCount}/{total})
          </Text>
        </Pressable>
      )}

      <View style={styles.list}>
        {progress.map((item) => (
          <NarrationRow key={item.topicId} item={item} theme={theme} />
        ))}
      </View>

      {finished && (
        <Text style={styles.finishedNote}>
          Narration clips are saved into this book. Open a topic to play them back.
        </Text>
      )}
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  wrap: { gap: spacing.sm, marginTop: spacing.lg },
  header: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
  title: { fontSize: typography.sizeMd, fontWeight: "600" as const, color: c.text },
  summary: { color: c.textSecondary, fontSize: typography.sizeSm },
  errorBanner: {
    backgroundColor: c.error + "22",
    borderColor: c.error + "66",
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorBannerText: { color: c.error, fontSize: typography.sizeSm },
  actionBtn: {
    backgroundColor: c.surfaceHigh,
    borderColor: c.primary,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center" as const,
  },
  actionBtnDisabled: { opacity: 0.6 },
  cancelBtn: { backgroundColor: c.warning, borderColor: c.warning },
  actionBtnText: { color: c.primary, fontSize: typography.sizeMd, fontWeight: "700" as const },
  cancelBtnText: { color: c.primaryText, fontSize: typography.sizeMd, fontWeight: "700" as const },
  list: { gap: spacing.xs },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  glyph: { width: 18, textAlign: "center" as const, fontSize: typography.sizeMd, fontWeight: "700" as const },
  glyph_pending: { color: c.textMuted },
  glyph_generating: { color: c.primary },
  glyph_done: { color: c.success },
  glyph_failed: { color: c.error },
  spinner: { width: 18 },
  rowMain: { flex: 1 },
  rowTitle: { color: c.text, fontSize: typography.sizeSm, fontWeight: "600" as const },
  rowError: { color: c.error, fontSize: typography.sizeXs, marginTop: 2 },
  finishedNote: {
    color: c.textMuted,
    fontSize: typography.sizeXs,
    textAlign: "center" as const,
    marginTop: spacing.xs,
  },
});
