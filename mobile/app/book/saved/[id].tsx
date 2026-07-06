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
import { PublishButton } from "@/components/PublishButton";
import { ExportBookJsonButton } from "@/components/ExportBookJsonButton";
import { ShareDraftModal } from "@/components/ShareDraftModal";
import { HelpButton } from "@/components/HelpButton";
import { PageContainer } from "@/components/PageContainer";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { RequireSignIn } from "@/auth/RequireSignIn";
import { useAuth } from "@/auth/AuthProvider";
import type { Book } from "@/types/book";

export default function SavedBookScreen() {
  return (
    <RequireSignIn action="edit a book">
      <SavedBookScreenInner />
    </RequireSignIn>
  );
}

function SavedBookScreenInner() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accessToken } = useAuth();
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);

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
          initialDescription={book.metadata?.description}
          initialTags={book.metadata?.tags}
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

        <PublishButton bookId={book.id} />
        <Text style={styles.generateHint}>
          Publishes the EPUB + PDF to the Open Library so readers can see and
          download them (their availability shows as green on the shelf).
        </Text>

        {accessToken ? (
          <>
            <Pressable
              style={styles.generateBtn}
              onPress={() => setShareOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Share this draft"
            >
              <Text style={styles.generateBtnText}>Share draft</Text>
            </Pressable>
            <Text style={styles.generateHint}>
              Invite reviewers by email to read this draft and leave comments
              before you publish it.
            </Text>
            <HelpButton topic="share-a-draft" label="How sharing works" />
            <ShareDraftModal
              visible={shareOpen}
              book={book}
              token={accessToken}
              onClose={() => setShareOpen(false)}
            />
          </>
        ) : null}

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
