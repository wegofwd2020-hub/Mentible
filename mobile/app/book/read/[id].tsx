import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { loadBook } from "@/storage/bookStore";
import { openEpub } from "@/storage/epubLibrary";
import { TopicReadList } from "@/components/TopicReadList";
import { CheckoutButton } from "@/components/CheckoutButton";
import { PageContainer } from "@/components/PageContainer";
import { colors, radius, spacing, typography } from "@/constants/theme";
import type { Book } from "@/types/book";

// Reading view for a Library book: browse its topics (reusing the topic reader)
// and "check out" a copy as EPUB3 or PDF. The Library entry and the source book
// share an id, so we read the source book's content here (Option A).
export default function ReadBookScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const loaded = id ? await loadBook(id) : null;
      if (mounted) {
        setBook(loaded);
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Source book gone (deleted) but the compiled EPUB may still be in the Library.
  if (!book) {
    return (
      <View style={styles.centered}>
        <Text style={styles.missing}>
          The source book is no longer available to read, but you can still
          download the saved EPUB.
        </Text>
        <Pressable
          style={styles.dlBtn}
          onPress={() => id && openEpub(id, "book").catch(() => {})}
          accessibilityRole="button"
          accessibilityLabel="Download saved EPUB"
        >
          <Text style={styles.dlBtnText}>Download EPUB</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <PageContainer>
        <Text style={styles.title}>{book.title}</Text>
        <TopicReadList
          book={book}
          onOpen={(topicId) => router.push(`/book/topic/${book.id}/${topicId}`)}
        />
        <CheckoutButton book={book} />
      </PageContainer>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1 },
  title: { fontSize: typography.sizeLg, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  missing: { color: colors.textSecondary, fontSize: typography.sizeMd, textAlign: "center", lineHeight: 22 },
  dlBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  dlBtnText: { color: colors.primaryText, fontWeight: "700", fontSize: typography.sizeMd },
});
