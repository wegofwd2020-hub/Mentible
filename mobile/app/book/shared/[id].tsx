import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PageContainer } from "@/components/PageContainer";
import { useAuth } from "@/auth/AuthProvider";
import { getSharedDraft, listComments, postComment, type DraftComment } from "@/api/client";
import { TopicReadList } from "@/components/TopicReadList";
import { TopicRenderer } from "@/components/LessonRenderer";
import { DraftCommentThread } from "@/components/DraftCommentThread";
import type { Book } from "@/types/book";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

// Full-screen, read-only reader for a draft shared with the signed-in user
// (ADR-027 D2–D4). Same reading UI as the Studio book screen — a contents list
// that opens each topic full-width — plus the comment thread. Sourced from the
// server-fetched draft, so it needs no local copy of the book.
export default function SharedDraftReader(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { accessToken } = useAuth();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [book, setBook] = useState<Book | null>(null);
  const [version, setVersion] = useState("1.0");
  const [topicId, setTopicId] = useState<string | null>(null);
  const [comments, setComments] = useState<DraftComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      if (!id || !accessToken) {
        if (mounted) {
          setError("Sign in to read shared drafts.");
          setLoading(false);
        }
        return;
      }
      try {
        const res = await getSharedDraft(id, accessToken);
        const v = res.version ?? "1.0";
        if (!mounted) return;
        setBook(res.book_json as Book);
        setVersion(v);
        setComments(await listComments(id, v, accessToken));
      } catch {
        if (mounted) setError("Couldn't load this draft.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id, accessToken]);

  const onPost = useCallback(
    (body: string) => {
      if (!id || !accessToken) return;
      void postComment(id, version, body, accessToken)
        .then(() => listComments(id, version, accessToken))
        .then(setComments)
        .catch(() => setError("Couldn't post your comment."));
    },
    [id, version, accessToken],
  );

  if (loading) {
    return (
      // flex:1 so the centered (flex:1) child has a bounded parent — otherwise it
      // collapses to 0 height on native (New Arch), hiding the spinner/text.
      <PageContainer style={{ flex: 1 }}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      </PageContainer>
    );
  }

  if (error || !book) {
    return (
      <PageContainer style={{ flex: 1 }}>
        <View style={styles.centered}>
          <Text style={styles.error}>{error ?? "This draft is unavailable."}</Text>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={styles.backBtn}>
            <Text style={styles.backBtnText}>Back</Text>
          </Pressable>
        </View>
      </PageContainer>
    );
  }

  const topic = topicId && book.content ? book.content[topicId] : null;
  // A shared draft carries figure REFS but never the bytes (they stay on the
  // author's device — ADR-035 D4 fences figure distribution), and TopicRenderer
  // renders nothing for a figure it can't resolve. Say so rather than leave a
  // reviewer silently short of what they were asked to review (#320).
  const hiddenFigures = topic?.images?.length ?? 0;

  // Topic view: a flex:1 chain fills the page and lets the WebView-backed
  // TopicRenderer scroll its own content (mirrors the Studio topic screen).
  // A ScrollView here would give the flex:1 renderer no definite height and
  // collapse it to a tiny box — the bug this route originally had.
  if (topic) {
    return (
      <View style={styles.screen}>
        <View style={styles.topicBar}>
          <Pressable onPress={() => setTopicId(null)} accessibilityRole="button" accessibilityLabel="Back to contents" hitSlop={8}>
            <Text style={styles.back}>← Contents</Text>
          </Pressable>
        </View>
        {hiddenFigures > 0 && (
          <View style={styles.figuresNotice}>
            <Text style={styles.figuresNoticeText}>
              {hiddenFigures === 1
                ? "1 figure isn't included in shared drafts."
                : `${hiddenFigures} figures aren't included in shared drafts.`}
            </Text>
          </View>
        )}
        <View style={styles.topicBody}>
          <TopicRenderer topic={topic} />
        </View>
      </View>
    );
  }

  // Contents view: a normal scrolling page (the list + the comment thread).
  // PageContainer + ScrollView both flex:1 so the ScrollView has a bounded
  // height and actually scrolls — an unbounded ScrollView here clipped the
  // list/comments on native (RNW/native both need a flex chain to the screen).
  return (
    <PageContainer style={{ flex: 1 }}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{book.title}</Text>
        <TopicReadList book={book} onOpen={setTopicId} />
        <Text style={styles.commentsHeader}>Comments</Text>
        <DraftCommentThread comments={comments} isOwner={false} onPost={onPost} />
      </ScrollView>
    </PageContainer>
  );
}

const makeStyles = (c: Palette) => ({
  centered: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, gap: spacing.md, padding: spacing.lg },
  error: { fontSize: typography.sizeMd, color: c.textSecondary, textAlign: "center" as const },
  backBtn: { backgroundColor: c.surfaceHigh, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  backBtnText: { color: c.text, fontWeight: "700" as const, fontSize: typography.sizeSm },
  scroll: { flex: 1, backgroundColor: "transparent" },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  title: { fontSize: typography.sizeXl, fontWeight: "700" as const, color: c.text },
  screen: { flex: 1, backgroundColor: "transparent" },
  topicBar: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  topicBody: { flex: 1 },
  back: { fontSize: typography.sizeSm, fontWeight: "700" as const, color: c.primary },
  figuresNotice: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: c.surfaceHigh,
  },
  figuresNoticeText: { fontSize: typography.sizeSm, color: c.textSecondary },
  commentsHeader: { fontSize: typography.sizeMd, fontWeight: "700" as const, color: c.text, marginTop: spacing.md },
});
