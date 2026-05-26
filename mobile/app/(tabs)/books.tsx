import React, { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { deleteBook, loadBookIndex } from "@/storage/bookStore";
import { colors, radius, spacing, typography } from "@/constants/theme";
import type { BookMeta } from "@/types/book";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function NewBookButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      style={styles.newBtn}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="New book"
    >
      <Text style={styles.newBtnText}>+ New book</Text>
    </Pressable>
  );
}

export default function BooksScreen() {
  const router = useRouter();
  const [books, setBooks] = useState<BookMeta[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadBookIndex().then(setBooks);
    }, []),
  );

  const handleDelete = useCallback(async (id: string) => {
    await deleteBook(id);
    setBooks((prev) => prev.filter((m) => m.id !== id));
  }, []);

  if (books.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>📖</Text>
        <Text style={styles.emptyTitle}>No books yet</Text>
        <Text style={styles.emptyBody}>
          Paste a table of contents and we’ll turn it into an editable topic
          tree you can build a book from.
        </Text>
        <NewBookButton onPress={() => router.push("/book/new")} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={books}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={<NewBookButton onPress={() => router.push("/book/new")} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      renderItem={({ item }) => (
        <Pressable
          style={styles.card}
          onPress={() => router.push(`/book/saved/${item.id}`)}
          accessibilityRole="button"
          accessibilityLabel={`Open book: ${item.title}`}
        >
          <View style={styles.cardMain}>
            <Text style={styles.title} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={styles.meta}>
              {item.subjectCount} subject{item.subjectCount === 1 ? "" : "s"} ·{" "}
              {item.unitCount} topic{item.unitCount === 1 ? "" : "s"} ·{" "}
              {formatDate(item.updatedAt)}
            </Text>
          </View>
          <Pressable
            style={styles.deleteBtn}
            onPress={() => handleDelete(item.id)}
            accessibilityRole="button"
            accessibilityLabel={`Delete book: ${item.title}`}
            hitSlop={8}
          >
            <Text style={styles.deleteIcon}>🗑</Text>
          </Pressable>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.background },
  listContent: { padding: spacing.md },
  separator: { height: spacing.sm },
  newBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    marginBottom: spacing.md,
  },
  newBtnText: { color: colors.primaryText, fontSize: typography.sizeMd, fontWeight: "700" },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  cardMain: { flex: 1, gap: spacing.xs },
  title: { fontSize: typography.sizeMd, fontWeight: "700", color: colors.text },
  meta: { fontSize: typography.sizeXs, color: colors.textMuted },
  deleteBtn: { padding: spacing.xs },
  deleteIcon: { fontSize: 18 },
  empty: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: typography.sizeLg, fontWeight: "700", color: colors.text },
  emptyBody: {
    fontSize: typography.sizeSm,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 22,
    maxWidth: 280,
  },
});
