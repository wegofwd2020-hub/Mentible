import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Alert } from "@/lib/alert";
import { myDrafts, type DraftReview } from "@/api/client";
import { ShareDraftModal } from "@/components/ShareDraftModal";
import { loadBook } from "@/storage/bookStore";
import type { Book } from "@/types/book";
import { colors, radius, spacing, typography } from "@/constants/theme";

// Author-side Library section: the shared drafts that have reviewer comments
// (ADR-027 D2–D4 feedback inbox). Self-hides when signed out or empty; refetches
// on screen focus. Tapping a row loads the local book and opens ShareDraftModal.
export function DraftReviews({ token }: { token: string | null }): React.JSX.Element | null {
  const [items, setItems] = useState<DraftReview[]>([]);
  const [modalBook, setModalBook] = useState<Book | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        if (!token) {
          setItems([]);
          return;
        }
        try {
          setItems(await myDrafts(token));
        } catch {
          setItems([]);
        }
      })();
    }, [token]),
  );

  const openReview = useCallback(async (bookId: string) => {
    const book = await loadBook(bookId);
    if (!book) {
      Alert.alert("Not on this device", "Open this book from your Library to review its feedback.");
      return;
    }
    setModalBook(book);
  }, []);

  if (!token || items.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.header}>Feedback on your drafts</Text>
      {items.map((it) => (
        <Pressable
          key={it.book_id}
          onPress={() => openReview(it.book_id)}
          accessibilityRole="button"
          accessibilityLabel={`Review feedback: ${it.title}`}
          style={styles.item}
        >
          <Text style={styles.itemTitle} numberOfLines={1}>
            {it.title}
          </Text>
          <Text style={styles.count}>
            {it.comment_count} {it.comment_count === 1 ? "comment" : "comments"}
          </Text>
        </Pressable>
      ))}
      {modalBook && token ? (
        <ShareDraftModal visible book={modalBook} token={token} onClose={() => setModalBook(null)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs },
  header: { fontSize: typography.sizeMd, fontWeight: "700", color: colors.text },
  item: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  itemTitle: { fontSize: typography.sizeSm, fontWeight: "700", color: colors.text, flexShrink: 1 },
  count: { fontSize: typography.sizeXs, color: colors.growth, fontWeight: "700" },
});
