import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { generatedTopicIds, loadBook, saveBook, setTopicContent } from "@/storage/bookStore";
import { loadApiKey } from "@/secure/keyStore";
import { useGenerateAll, type TopicProgress } from "@/hooks/useGenerateAll";
import { GenerationParamsEditor } from "@/components/GenerationParamsEditor";
import { HelpButton } from "@/help";
import { useResponsive } from "@/hooks/useResponsive";
import { MAX_WIDE_WIDTH } from "@/constants/layout";
import { DEFAULT_GENERATION_PARAMS, type GenerationParams } from "@/types/generationParams";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";
import { demoBlocked } from "@/constants/demo";
import { RequireSignIn } from "@/auth/RequireSignIn";
import type { Book } from "@/types/book";
import type { LessonOutput, Provenance } from "@/types/lesson";

const STATUS_GLYPH: Record<TopicProgress["status"], string> = {
  pending: "○",
  generating: "…",
  done: "✓",
  failed: "✕",
};

function StatusRow({
  item,
  onOpen,
  theme,
}: {
  item: TopicProgress;
  onOpen?: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  const styles = useThemedStyles(makeStyles);
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
      {tappable && <Text style={styles.openChevron}>›</Text>}
    </Pressable>
  );
}

export default function GenerateAllScreen() {
  return (
    <RequireSignIn action="generate content">
      <GenerateAllScreenInner />
    </RequireSignIn>
  );
}

function GenerateAllScreenInner() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  // The book's generation template (level / depth / pages). Edits persist back
  // to the book, so the template is the single source of truth for this book.
  const [params, setParams] = useState<GenerationParams>(DEFAULT_GENERATION_PARAMS);
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
        if (loaded?.generationParams) setParams(loaded.generationParams);
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  // Topics already generated before this run — skipped + shown as done. Captured
  // from the initial load so it stays stable while the loop runs. Only counts
  // topics with a RENDERABLE lesson, so a topic left with an empty/partial entry
  // (e.g. a discarded slow generation) is re-run by gap-fill instead of skipped.
  const initialDoneIds = useMemo(
    () => (book ? generatedTopicIds(book) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book?.id],
  );

  // Load the key for the book's pinned provider (defaults to anthropic).
  const getApiKey = useCallback(() => loadApiKey(params.provider), [params.provider]);

  const handleTopicDone = useCallback(
    async (topicId: string, title: string, lesson: LessonOutput, provenance?: Provenance) => {
      const base = bookRef.current;
      if (!base) return;
      const next = setTopicContent(base, {
        topicId,
        title,
        lesson,
        generatedAt: new Date().toISOString(),
        provenance,
      });
      bookRef.current = next;
      setBook(next);
      await saveBook(next);
    },
    [],
  );

  // Persist template edits back to the book so they stick across sessions.
  const handleParamsChange = useCallback((next: GenerationParams) => {
    setParams(next);
    const base = bookRef.current;
    if (!base) return;
    const updated = { ...base, generationParams: next, updatedAt: new Date().toISOString() };
    bookRef.current = updated;
    setBook(updated);
    void saveBook(updated);
  }, []);

  const { progress, running, finished, doneCount, failedCount, total, errorMsg, start, cancel } =
    useGenerateAll({
      toc: book?.toc ?? { subjects: [] },
      params,
      getApiKey,
      onTopicDone: handleTopicDone,
      alreadyDone: initialDoneIds,
    });

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.primary} />
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
          <HelpButton topic="scoped-generation" label="How generation works" />

          {!running && (
            <GenerationParamsEditor value={params} onChange={handleParamsChange} />
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
                onPress={() => {
                  if (demoBlocked()) return;
                  start();
                }}
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
                  onPress={() => {
                    if (demoBlocked()) return;
                    start({ force: true });
                  }}
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
                theme={theme}
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

const makeStyles = (c: Palette) => ({
  scroll: { flex: 1 as const, backgroundColor: "transparent" },
  scrollContent: { flexGrow: 1 },
  page: { padding: spacing.md, gap: spacing.sm },
  // Desktop: cap + center, lay controls and progress side by side.
  pageWide: { maxWidth: MAX_WIDE_WIDTH, width: "100%" as const, alignSelf: "center" as const },
  pageRow: { flexDirection: "row" as const, gap: spacing.lg, alignItems: "flex-start" as const },
  // minWidth: 0 lets each column shrink to its flex allocation. Without it,
  // react-native-web's default `min-width: auto` keeps the options column as wide
  // as its horizontal option rows (they refuse to shrink), so it overflows its
  // flex share and pushes/overlaps the topics column.
  col: { gap: spacing.sm, minWidth: 0 },
  colLeft: { flex: 4 },
  colRight: { flex: 6 },
  centered: {
    flex: 1 as const,
    backgroundColor: "transparent",
    alignItems: "center" as const,
    justifyContent: "center" as const,
    padding: spacing.xl,
  },
  missing: { color: c.textSecondary, fontSize: typography.sizeMd },
  bookTitle: { color: c.text, fontSize: typography.sizeXl, fontWeight: "700" as const },
  summary: { color: c.textSecondary, fontSize: typography.sizeSm, marginBottom: spacing.sm },
  label: {
    fontSize: typography.sizeSm,
    fontWeight: "600" as const,
    color: c.textSecondary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.8,
  },
  pagesRow: { flexDirection: "row" as const, alignItems: "stretch" as const, gap: spacing.xs },
  pagesInput: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: c.text,
    fontSize: typography.sizeLg,
    fontWeight: "700" as const,
  },
  pagesInputFlex: { flex: 1 },
  stepBtn: {
    justifyContent: "center" as const,
    alignItems: "center" as const,
    paddingHorizontal: spacing.md,
    minWidth: 52,
    backgroundColor: c.surfaceHigh,
    borderColor: c.primary,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  stepBtnText: { color: c.primary, fontSize: typography.sizeMd, fontWeight: "700" as const },
  pagesHint: { color: c.textMuted, fontSize: typography.sizeXs },
  errorBanner: {
    backgroundColor: c.error + "22",
    borderColor: c.error + "66",
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorBannerText: { color: c.error, fontSize: typography.sizeSm },
  actionBtn: {
    backgroundColor: c.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center" as const,
    marginVertical: spacing.sm,
  },
  cancelBtn: { backgroundColor: c.warning },
  actionBtnText: { color: c.primaryText, fontSize: typography.sizeMd, fontWeight: "700" as const },
  // Outline (destructive-ish) so "overwrite" reads as the deliberate, secondary action.
  regenBtn: {
    backgroundColor: "transparent" as const,
    borderColor: c.warning,
    borderWidth: 1,
    marginTop: 0,
  },
  regenBtnText: { color: c.warning, fontSize: typography.sizeMd, fontWeight: "700" as const },
  list: { gap: spacing.xs },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  glyph: { width: 18, textAlign: "center" as const, fontSize: typography.sizeMd, fontWeight: "700" as const },
  glyph_pending: { color: c.textMuted },
  glyph_generating: { color: c.primary },
  glyph_done: { color: c.success },
  glyph_failed: { color: c.error },
  spinner: { width: 18 },
  rowMain: { flex: 1 },
  rowTitle: { color: c.text, fontSize: typography.sizeMd, fontWeight: "600" as const },
  rowError: { color: c.error, fontSize: typography.sizeXs, marginTop: 2 },
  openChevron: { color: c.textMuted, fontSize: typography.sizeXl, fontWeight: "700" as const },
  finishedNote: {
    color: c.textMuted,
    fontSize: typography.sizeSm,
    textAlign: "center" as const,
    marginTop: spacing.md,
  },
});
