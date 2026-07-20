import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { loadBook } from "@/storage/bookStore";
import { ChapterRenderer, QuizRenderer } from "@/components/LessonRenderer";
import { PageContainer } from "@/components/PageContainer";
import { useGenerateChapterQuiz } from "@/hooks/useGenerateChapterQuiz";
import { IS_DEMO } from "@/constants/demo";
import { colors, radius, spacing, typography } from "@/constants/theme";
import type { ImportedChapter, QuizSet } from "@/types/book";

// One chapter of an IMPORTED book (Open Shelves F1). Deliberately read-only:
// unlike the topic screen there is no Regenerate, no enhancement instructions,
// and no trust manifest. The text is a third party's public-domain work — it is
// not ours to rewrite, and not ours to attest to (ADR-028: we are a catalog
// client; the content never touched our infrastructure).
//
// F2 adds one thing on top of that read-only text: "Make a quiz from this
// chapter" — an on-demand, source-grounded QuizSet generated from the
// chapter's own plaintext (useGenerateChapterQuiz) and rendered below it via
// the SAME render + sanitize path a topic uses (QuizRenderer). The chapter
// text itself is never touched by this — the quiz is a separate, device-local
// companion (book.chapterQuizzes[chapterId]).
export default function ReadChapterScreen() {
  const { bookId, chapterId } = useLocalSearchParams<{ bookId: string; chapterId: string }>();
  const [chapter, setChapter] = useState<ImportedChapter | null>(null);
  const [bookTitle, setBookTitle] = useState<string>("");
  const [quiz, setQuiz] = useState<QuizSet | null>(null);
  const [loading, setLoading] = useState(true);

  const { status, error, truncated, generate } = useGenerateChapterQuiz();
  const generating = status === "generating";

  useEffect(() => {
    let mounted = true;
    (async () => {
      const book = bookId ? await loadBook(bookId) : null;
      if (mounted) {
        setChapter(book?.chapters?.[chapterId] ?? null);
        setBookTitle(book?.title ?? "");
        setQuiz(book?.chapterQuizzes?.[chapterId] ?? null);
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [bookId, chapterId]);

  const handleMakeQuiz = useCallback(async () => {
    if (!bookId || !chapterId) return;
    const result = await generate(bookId, chapterId);
    if (result) setQuiz(result);
  }, [bookId, chapterId, generate]);

  // The trigger is available on both platforms (web imports EPUBs via the file
  // picker and generates through the same backend), hidden only in a demo build
  // (no backend). Note: click-to-reveal interactivity is wired on the web reader
  // (enhanceReaderNode → wireQuizzes); the native WebView renders the quiz
  // statically for now (native quiz-reveal is a tracked follow-up).
  const showTrigger = !IS_DEMO;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!chapter) {
    return (
      <View style={styles.centered}>
        <Text style={styles.missing}>That chapter is no longer available.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll}>
      {/* The nav header shows the BOOK title (context), NOT the chapter title —
          the chapter's own <h1> is already in the EPUB content, so putting the
          chapter title here too would double-print it (the web header renders
          as an <h1>). */}
      <Stack.Screen options={{ title: bookTitle || "Read" }} />
      <PageContainer>
        <ChapterRenderer chapter={chapter} />

        {showTrigger && (
          <View style={styles.quizBar}>
            {generating ? (
              <View style={styles.quizBusy}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.quizBusyText}>Generating quiz…</Text>
              </View>
            ) : (
              <Pressable
                style={styles.quizBtn}
                onPress={handleMakeQuiz}
                accessibilityRole="button"
                accessibilityLabel={
                  quiz ? "Regenerate the quiz for this chapter" : "Make a quiz from this chapter"
                }
              >
                <Text style={styles.quizBtnText}>
                  {quiz ? "↻ Regenerate quiz" : "Make a quiz from this chapter"}
                </Text>
              </Pressable>
            )}
            <Text style={styles.quizHint}>Uses your LLM key.</Text>
            {truncated && (
              <Text style={styles.quizTruncated}>
                This chapter is long — the quiz covers the first part only.
              </Text>
            )}
            {error && <Text style={styles.quizError}>{error}</Text>}
          </View>
        )}

        {quiz && <QuizRenderer quiz={quiz} />}
      </PageContainer>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  missing: { fontSize: typography.sizeMd, color: colors.textSecondary, textAlign: "center" },
  quizBar: {
    gap: spacing.xs,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  quizBtn: {
    alignSelf: "flex-start",
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  quizBtnText: { color: colors.primary, fontSize: typography.sizeSm, fontWeight: "700" },
  quizBusy: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  quizBusyText: { color: colors.primary, fontSize: typography.sizeSm, fontWeight: "600" },
  quizHint: { color: colors.textMuted, fontSize: typography.sizeXs },
  quizTruncated: { color: colors.warning, fontSize: typography.sizeXs },
  quizError: { color: colors.error, fontSize: typography.sizeSm },
});
