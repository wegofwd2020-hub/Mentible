import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { loadBook, saveBook, setTopicContent } from "@/storage/bookStore";
import { loadApiKey } from "@/secure/keyStore";
import { useGenerateAll, type TopicProgress } from "@/hooks/useGenerateAll";
import { LevelPicker } from "@/components/LevelPicker";
import { useResponsive } from "@/hooks/useResponsive";
import { MAX_WIDE_WIDTH } from "@/constants/layout";
import { DEFAULT_LEVEL } from "@/constants/levels";
import { colors, radius, spacing, typography } from "@/constants/theme";
import type { Book } from "@/types/book";
import type { LessonOutput } from "@/types/lesson";

const STATUS_GLYPH: Record<TopicProgress["status"], string> = {
  pending: "○",
  generating: "…",
  done: "✓",
  failed: "✕",
};

function StatusRow({
  item,
  onOpen,
}: {
  item: TopicProgress;
  onOpen?: () => void;
}) {
  const tappable = item.status === "done" && onOpen;
  return (
    <Pressable
      style={styles.row}
      disabled={!tappable}
      onPress={onOpen}
      accessibilityRole={tappable ? "button" : undefined}
      accessibilityLabel={
        tappable ? `Open generated topic: ${item.title}` : `${item.title} — ${item.status}`
      }
    >
      <Text style={[styles.glyph, styles[`glyph_${item.status}`]]}>
        {item.status === "generating" ? "" : STATUS_GLYPH[item.status]}
      </Text>
      {item.status === "generating" && (
        <ActivityIndicator size="small" color={colors.primary} style={styles.spinner} />
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
      {tappable && <Text style={styles.openChevron}>›</Text>}
    </Pressable>
  );
}

export default function GenerateAllScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [level, setLevel] = useState(DEFAULT_LEVEL);
  const { isDesktop } = useResponsive();

  // Hold the live book in a ref so per-topic persistence always builds on the
  // latest content without re-creating the generation loop.
  const bookRef = useRef<Book | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const loaded = id ? await loadBook(id) : null;
      if (mounted) {
        bookRef.current = loaded;
        setBook(loaded);
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  // Topics already generated before this run — skipped + shown as done. Captured
  // from the initial load so it stays stable while the loop runs.
  const initialDoneIds = useMemo(
    () => Object.keys(book?.content ?? {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book?.id],
  );

  const getApiKey = useCallback(() => loadApiKey(), []);

  const handleTopicDone = useCallback(
    async (topicId: string, title: string, lesson: LessonOutput) => {
      const base = bookRef.current;
      if (!base) return;
      const next = setTopicContent(base, {
        topicId,
        title,
        lesson,
        generatedAt: new Date().toISOString(),
      });
      bookRef.current = next;
      setBook(next);
      await saveBook(next);
    },
    [],
  );

  const { progress, running, finished, doneCount, failedCount, total, errorMsg, start, cancel } =
    useGenerateAll({
      toc: book?.toc ?? { subjects: [] },
      level,
      getApiKey,
      onTopicDone: handleTopicDone,
      alreadyDone: initialDoneIds,
    });

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!book) {
    return (
      <View style={styles.centered}>
        <Text style={styles.missing}>This book could not be found.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <View
        style={[styles.page, isDesktop && styles.pageWide, isDesktop && styles.pageRow]}
      >
        {/* Controls — left sidebar on desktop, top block on mobile */}
        <View style={[styles.col, isDesktop && styles.colLeft]}>
          <Text style={styles.bookTitle}>{book.title}</Text>
          <Text style={styles.summary}>
            {total} topic{total === 1 ? "" : "s"} · {doneCount} generated
            {failedCount > 0 ? ` · ${failedCount} failed` : ""}
          </Text>

          {!running && !finished && (
            <>
              <Text style={styles.label}>Level</Text>
              <LevelPicker value={level} onChange={setLevel} />
            </>
          )}

          {errorMsg && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{errorMsg}</Text>
            </View>
          )}

          {!running ? (
            <Pressable
              style={styles.actionBtn}
              onPress={start}
              accessibilityRole="button"
              accessibilityLabel={finished ? "Generate remaining topics" : "Generate all topics"}
            >
              <Text style={styles.actionBtnText}>
                {finished
                  ? failedCount > 0
                    ? "Retry failed / remaining"
                    : "Done — regenerate gaps"
                  : doneCount > 0
                    ? "Generate remaining topics"
                    : "Generate all topics"}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.actionBtn, styles.cancelBtn]}
              onPress={cancel}
              accessibilityRole="button"
              accessibilityLabel="Stop generating"
            >
              <Text style={styles.actionBtnText}>Stop ({doneCount}/{total})</Text>
            </Pressable>
          )}
        </View>

        {/* Topic progress — right column on desktop */}
        <View style={[styles.col, isDesktop && styles.colRight]}>
          <View style={styles.list}>
            {progress.map((item) => (
              <StatusRow
                key={item.topicId}
                item={item}
                onOpen={() => router.push(`/book/topic/${book.id}/${item.topicId}`)}
              />
            ))}
          </View>

          {finished && (
            <Text style={styles.finishedNote}>
              Tap any generated topic (✓) to read it. Your lessons are saved to this book.
            </Text>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1 },
  page: { padding: spacing.md, gap: spacing.sm },
  // Desktop: cap + center, lay controls and progress side by side.
  pageWide: { maxWidth: MAX_WIDE_WIDTH, width: "100%", alignSelf: "center" },
  pageRow: { flexDirection: "row", gap: spacing.lg, alignItems: "flex-start" },
  col: { gap: spacing.sm },
  colLeft: { flex: 4 },
  colRight: { flex: 6 },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  missing: { color: colors.textSecondary, fontSize: typography.sizeMd },
  bookTitle: { color: colors.text, fontSize: typography.sizeXl, fontWeight: "700" },
  summary: { color: colors.textSecondary, fontSize: typography.sizeSm, marginBottom: spacing.sm },
  label: {
    fontSize: typography.sizeSm,
    fontWeight: "600",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  errorBanner: {
    backgroundColor: colors.error + "22",
    borderColor: colors.error + "66",
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorBannerText: { color: colors.error, fontSize: typography.sizeSm },
  actionBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    marginVertical: spacing.sm,
  },
  cancelBtn: { backgroundColor: colors.warning },
  actionBtnText: { color: colors.primaryText, fontSize: typography.sizeMd, fontWeight: "700" },
  list: { gap: spacing.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  glyph: { width: 18, textAlign: "center", fontSize: typography.sizeMd, fontWeight: "700" },
  glyph_pending: { color: colors.textMuted },
  glyph_generating: { color: colors.primary },
  glyph_done: { color: colors.success },
  glyph_failed: { color: colors.error },
  spinner: { width: 18 },
  rowMain: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: typography.sizeMd, fontWeight: "600" },
  rowError: { color: colors.error, fontSize: typography.sizeXs, marginTop: 2 },
  openChevron: { color: colors.textMuted, fontSize: typography.sizeXl, fontWeight: "700" },
  finishedNote: {
    color: colors.textMuted,
    fontSize: typography.sizeSm,
    textAlign: "center",
    marginTop: spacing.md,
  },
});
