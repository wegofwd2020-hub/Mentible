import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { loadBook } from "@/storage/bookStore";
import { ChapterRenderer, QuizRenderer } from "@/components/LessonRenderer";
import { PageContainer } from "@/components/PageContainer";
import { useGenerateChapterQuiz } from "@/hooks/useGenerateChapterQuiz";
import { useNudge } from "@/discovery/useNudge";
import { DiscoveryNudge } from "@/discovery/DiscoveryNudge";
import { IS_DEMO } from "@/constants/demo";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";
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
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [chapter, setChapter] = useState<ImportedChapter | null>(null);
  const [bookTitle, setBookTitle] = useState<string>("");
  const [quiz, setQuiz] = useState<QuizSet | null>(null);
  const [loading, setLoading] = useState(true);

  const { status, error, truncated, generate } = useGenerateChapterQuiz();
  const generating = status === "generating";
  const quizNudge = useNudge("chapter-quiz");

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
        <ActivityIndicator size="large" color={theme.primary} />
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

        {showTrigger && quizNudge.visible && (
          <DiscoveryNudge
            text="New — make a quiz from this chapter to test yourself."
            onDismiss={quizNudge.dismiss}
            testID="nudge-chapter-quiz"
          />
        )}

        {showTrigger && (
          <View style={styles.quizBar}>
            {generating ? (
              <View style={styles.quizBusy}>
                <ActivityIndicator size="small" color={theme.primary} />
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

const makeStyles = (c: Palette) => ({
  scroll: { flex: 1, backgroundColor: "transparent" },
  centered: {
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    padding: spacing.lg,
    backgroundColor: "transparent",
  },
  missing: { fontSize: typography.sizeMd, color: c.textSecondary, textAlign: "center" as const },
  quizBar: {
    gap: spacing.xs,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    borderColor: c.border,
    borderWidth: 1,
    backgroundColor: c.surface,
  },
  quizBtn: {
    alignSelf: "flex-start" as const,
    borderColor: c.primary,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  quizBtnText: { color: c.primary, fontSize: typography.sizeSm, fontWeight: "700" as const },
  quizBusy: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs },
  quizBusyText: { color: c.primary, fontSize: typography.sizeSm, fontWeight: "600" as const },
  quizHint: { color: c.textMuted, fontSize: typography.sizeXs },
  quizTruncated: { color: c.warning, fontSize: typography.sizeXs },
  quizError: { color: c.error, fontSize: typography.sizeSm },
});
