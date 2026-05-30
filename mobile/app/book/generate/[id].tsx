import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
  // Whole-book page target. Held as a raw digit string (empty = no limit) so the
  // input never reformats mid-edit — reformatting a controlled TextInput on each
  // keystroke triggers RN's cursor-jump bug and makes typing feel broken.
  const [pagesText, setPagesText] = useState("");
  const totalPages = Math.max(0, parseInt(pagesText, 10) || 0);
  // Step the page count with buttons — works without a soft keyboard (the
  // emulator doesn't always render one). 0 clears back to the placeholder.
  const adjustPages = (delta: number) => {
    const next = Math.min(999, Math.max(0, totalPages + delta));
    setPagesText(next === 0 ? "" : String(next));
  };
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
      totalPages,
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
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
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

          {!running && (
            <>
              <Text style={styles.label}>Level</Text>
              <LevelPicker value={level} onChange={setLevel} />

              <Text style={styles.label}>Pages (whole book)</Text>
              <View style={styles.pagesRow}>
                <Pressable
                  style={styles.stepBtn}
                  onPress={() => adjustPages(-10)}
                  accessibilityRole="button"
                  accessibilityLabel="Decrease pages by 10"
                >
                  <Text style={styles.stepBtnText}>−10</Text>
                </Pressable>
                <Pressable
                  style={styles.stepBtn}
                  onPress={() => adjustPages(-1)}
                  accessibilityRole="button"
                  accessibilityLabel="Decrease pages by 1"
                >
                  <Text style={styles.stepBtnText}>−1</Text>
                </Pressable>
                <TextInput
                  style={[styles.pagesInput, styles.pagesInputFlex]}
                  value={pagesText}
                  onChangeText={(t) => setPagesText(t.replace(/[^0-9]/g, ""))}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  maxLength={3}
                  textAlign="center"
                  accessibilityLabel="Target pages for the whole book — 0 means no limit"
                />
                <Pressable
                  style={styles.stepBtn}
                  onPress={() => adjustPages(1)}
                  accessibilityRole="button"
                  accessibilityLabel="Increase pages by 1"
                >
                  <Text style={styles.stepBtnText}>+1</Text>
                </Pressable>
                <Pressable
                  style={styles.stepBtn}
                  onPress={() => adjustPages(10)}
                  accessibilityRole="button"
                  accessibilityLabel="Increase pages by 10"
                >
                  <Text style={styles.stepBtnText}>+10</Text>
                </Pressable>
              </View>
              <Text style={styles.pagesHint}>
                Total pages across all topics, split evenly. 0 = as much as the
                model produces. Quizzes and answers don’t count. Use − / + if the
                keyboard doesn’t open.
              </Text>
            </>
          )}

          {errorMsg && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{errorMsg}</Text>
            </View>
          )}

          {!running ? (
            <>
              <Pressable
                style={styles.actionBtn}
                onPress={() => start()}
                accessibilityRole="button"
                accessibilityLabel={
                  doneCount > 0 ? "Generate remaining topics" : "Generate all topics"
                }
              >
                <Text style={styles.actionBtnText}>
                  {doneCount > 0
                    ? doneCount >= total
                      ? "All topics generated"
                      : "Generate remaining topics"
                    : "Generate all topics"}
                </Text>
              </Pressable>

              {/* Force a full redo, overwriting topics that already have content
                  — the trial/authoring loop of edit-then-regenerate. */}
              {doneCount > 0 && (
                <Pressable
                  style={[styles.actionBtn, styles.regenBtn]}
                  onPress={() => start({ force: true })}
                  accessibilityRole="button"
                  accessibilityLabel="Regenerate all topics, overwriting existing content"
                >
                  <Text style={styles.regenBtnText}>Regenerate all (overwrite)</Text>
                </Pressable>
              )}
            </>
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
  pagesRow: { flexDirection: "row", alignItems: "stretch", gap: spacing.xs },
  pagesInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: typography.sizeLg,
    fontWeight: "700",
  },
  pagesInputFlex: { flex: 1 },
  stepBtn: {
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    minWidth: 52,
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  stepBtnText: { color: colors.primary, fontSize: typography.sizeMd, fontWeight: "700" },
  pagesHint: { color: colors.textMuted, fontSize: typography.sizeXs },
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
  // Outline (destructive-ish) so "overwrite" reads as the deliberate, secondary action.
  regenBtn: {
    backgroundColor: "transparent",
    borderColor: colors.warning,
    borderWidth: 1,
    marginTop: 0,
  },
  regenBtnText: { color: colors.warning, fontSize: typography.sizeMd, fontWeight: "700" },
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
