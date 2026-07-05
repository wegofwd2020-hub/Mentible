import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { getSharedDraft, listComments, postComment, sharedWithMe, type DraftComment, type SharedItem } from "@/api/client";
import { DraftCommentThread } from "@/components/DraftCommentThread";
import { TopicReadList } from "@/components/TopicReadList";
import { TopicRenderer } from "@/components/LessonRenderer";
import type { Book } from "@/types/book";
import { colors, radius, spacing, typography } from "@/constants/theme";

// A Library-tab section listing drafts other authors have shared with the
// signed-in user (ADR-027 D2–D4). Self-hides when signed out or the list is
// empty — no "Shared with you" header in either case. Tapping an item opens a
// read view: the fetched draft's topics (reusing the same reader as the Library
// — TopicReadList index → TopicRenderer content, in-memory, no local storage)
// plus the comment thread (read-only responses for the recipient).
export function SharedWithYou({ token }: { token: string | null }): React.JSX.Element | null {
  const [items, setItems] = useState<SharedItem[]>([]);
  const [open, setOpen] = useState<SharedItem | null>(null);
  const [draftBook, setDraftBook] = useState<Book | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [comments, setComments] = useState<DraftComment[]>([]);

  // Refetch when the Library screen (re)gains focus, not just on mount — so a
  // draft shared while the recipient is elsewhere appears when they return here,
  // without a manual reload. Mirrors library.tsx's own focus-refetch.
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        if (!token) {
          setItems([]);
          return;
        }
        try {
          setItems(await sharedWithMe(token));
        } catch {
          setItems([]);
        }
      })();
    }, [token]),
  );

  const openDraft = useCallback(
    async (item: SharedItem) => {
      if (!token) return;
      setOpen(item);
      setTopicId(null);
      setDraftBook(null);
      try {
        const res = await getSharedDraft(item.book_id, token);
        setDraftBook(res.book_json as Book);
        setComments(await listComments(item.book_id, item.version, token));
      } catch {
        setDraftBook(null);
        setComments([]);
      }
    },
    [token],
  );

  const close = useCallback(() => {
    setOpen(null);
    setDraftBook(null);
    setTopicId(null);
  }, []);

  if (!token || items.length === 0) return null;

  const topic = topicId && draftBook?.content ? draftBook.content[topicId] : null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.header}>Shared with you</Text>
      {items.map((it) => (
        <Pressable
          key={it.book_id}
          onPress={() => openDraft(it)}
          accessibilityRole="button"
          accessibilityLabel={`Open shared draft: ${it.title}`}
          style={styles.item}
        >
          <Text style={styles.itemTitle}>{it.title}</Text>
          <Text style={styles.itemMeta}>v{it.version}</Text>
        </Pressable>
      ))}
      {open ? (
        <View style={styles.reader}>
          <View style={styles.readerHead}>
            <Text style={styles.readerTitle} numberOfLines={1}>
              {open.title}
            </Text>
            <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close draft" hitSlop={8}>
              <Text style={styles.close}>Close</Text>
            </Pressable>
          </View>
          {draftBook ? (
            topic ? (
              <View style={styles.topicWrap}>
                <Pressable onPress={() => setTopicId(null)} accessibilityRole="button" accessibilityLabel="Back to contents">
                  <Text style={styles.back}>← Contents</Text>
                </Pressable>
                <TopicRenderer topic={topic} />
              </View>
            ) : (
              <TopicReadList book={draftBook} onOpen={setTopicId} />
            )
          ) : (
            <Text style={styles.loading}>Loading…</Text>
          )}
          <DraftCommentThread
            comments={comments}
            isOwner={false}
            onPost={(body) =>
              void postComment(open.book_id, open.version, body, token)
                .then(() => listComments(open.book_id, open.version, token))
                .then(setComments)
                .catch(() => {})
            }
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs },
  header: { fontSize: typography.sizeMd, fontWeight: "700", color: colors.text },
  item: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  itemTitle: { fontSize: typography.sizeSm, fontWeight: "700", color: colors.text, flexShrink: 1 },
  itemMeta: { fontSize: typography.sizeXs, color: colors.textMuted },
  reader: { marginTop: spacing.sm, gap: spacing.sm },
  readerHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  readerTitle: { fontSize: typography.sizeLg, fontWeight: "700", color: colors.text, flexShrink: 1 },
  close: { fontSize: typography.sizeSm, fontWeight: "700", color: colors.primary },
  topicWrap: { gap: spacing.sm },
  back: { fontSize: typography.sizeSm, fontWeight: "700", color: colors.primary },
  loading: { fontSize: typography.sizeSm, color: colors.textMuted, fontStyle: "italic" },
});
