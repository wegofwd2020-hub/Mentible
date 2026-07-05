import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PageContainer } from "@/components/PageContainer";
import { useAuth } from "@/auth/AuthProvider";
import { getSharedDraft, listComments, postComment, type DraftComment } from "@/api/client";
import { TopicReadList } from "@/components/TopicReadList";
import { TopicRenderer } from "@/components/LessonRenderer";
import { DraftCommentThread } from "@/components/DraftCommentThread";
import type { Book } from "@/types/book";
import { colors, radius, spacing, typography } from "@/constants/theme";

// Full-screen, read-only reader for a draft shared with the signed-in user
// (ADR-027 D2–D4). Same reading UI as the Studio book screen — a contents list
// that opens each topic full-width — plus the comment thread. Sourced from the
// server-fetched draft, so it needs no local copy of the book.
export default function SharedDraftReader(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { accessToken } = useAuth();
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
      <PageContainer>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </PageContainer>
    );
  }

  if (error || !book) {
    return (
      <PageContainer>
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
        <View style={styles.topicBody}>
          <TopicRenderer topic={topic} />
        </View>
      </View>
    );
  }

  // Contents view: a normal scrolling page (the list + the comment thread).
  return (
    <PageContainer>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{book.title}</Text>
        <TopicReadList book={book} onOpen={setTopicId} />
        <Text style={styles.commentsHeader}>Comments</Text>
        <DraftCommentThread comments={comments} isOwner={false} onPost={onPost} />
      </ScrollView>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  error: { fontSize: typography.sizeMd, color: colors.textSecondary, textAlign: "center" },
  backBtn: { backgroundColor: colors.surfaceHigh, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  backBtnText: { color: colors.text, fontWeight: "700", fontSize: typography.sizeSm },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  title: { fontSize: typography.sizeXl, fontWeight: "700", color: colors.text },
  screen: { flex: 1, backgroundColor: colors.background },
  topicBar: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  topicBody: { flex: 1 },
  back: { fontSize: typography.sizeSm, fontWeight: "700", color: colors.primary },
  commentsHeader: { fontSize: typography.sizeMd, fontWeight: "700", color: colors.text, marginTop: spacing.md },
});
