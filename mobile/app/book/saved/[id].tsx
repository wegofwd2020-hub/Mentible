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
import { TopicReadList } from "@/components/TopicReadList";
import { SaveToLibraryButton } from "@/components/SaveToLibraryButton";
import { ExportBookJsonButton } from "@/components/ExportBookJsonButton";
import { PageContainer } from "@/components/PageContainer";
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
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <PageContainer>
        <TopicReadList
          book={book}
          onOpen={(topicId) => router.push(`/book/topic/${book.id}/${topicId}`)}
        />

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

        <View style={styles.publishDivider} />
        <Text style={styles.publishLabel}>Publish</Text>
        <SaveToLibraryButton bookId={book.id} />
        <Text style={styles.generateHint}>
          Compiles the generated topics into an EPUB3 and saves it to your
          Library. Generate the topics first.
        </Text>

        <ExportBookJsonButton book={book} />
        <Text style={styles.generateHint}>
          Downloads this book as a .book.json file you can back up or re-import
          on another device.
        </Text>
      </PageContainer>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1 },
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
  publishDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: spacing.xl,
  },
  publishLabel: {
    fontSize: typography.sizeSm,
    fontWeight: "600",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: spacing.md,
  },
});
