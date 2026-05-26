import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { loadBook } from "@/storage/bookStore";
import { BookEditor } from "@/components/BookEditor";
import { colors, radius, spacing, typography } from "@/constants/theme";
import type { Book } from "@/types/book";

export default function SavedBookScreen() {
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
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <BookEditor
        bookId={book.id}
        initialTitle={book.title}
        initialToc={book.toc}
        createdAt={book.createdAt}
        onSaved={() => router.replace("/books")}
      />

      <Pressable
        style={styles.generateBtn}
        onPress={() => router.push(`/book/generate/${book.id}`)}
        accessibilityRole="button"
        accessibilityLabel="Generate all topics"
      >
        <Text style={styles.generateBtnText}>Generate all topics →</Text>
      </Pressable>
      <Text style={styles.generateHint}>
        Save your edits first. Generation runs one topic at a time against your
        Anthropic key.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.md, gap: spacing.sm },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  missing: { color: colors.textSecondary, fontSize: typography.sizeMd },
  generateBtn: {
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  generateBtnText: { color: colors.primary, fontSize: typography.sizeMd, fontWeight: "700" },
  generateHint: {
    color: colors.textMuted,
    fontSize: typography.sizeXs,
    textAlign: "center",
    marginTop: spacing.xs,
  },
});
