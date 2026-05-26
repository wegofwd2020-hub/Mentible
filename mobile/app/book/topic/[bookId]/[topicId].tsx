import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { loadBook } from "@/storage/bookStore";
import { TopicRenderer } from "@/components/LessonRenderer";
import { colors, spacing, typography } from "@/constants/theme";
import type { GeneratedTopic } from "@/types/book";

// Renders one book topic's full generated content — lesson plus any tutorial,
// quiz sets, and experiment carried by the topic (e.g. a migrated book).
export default function BookTopicScreen() {
  const { bookId, topicId } = useLocalSearchParams<{ bookId: string; topicId: string }>();
  const [topic, setTopic] = useState<GeneratedTopic | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const book = bookId ? await loadBook(bookId) : null;
      const found = book?.content?.[topicId] ?? null;
      if (mounted) {
        setTopic(found);
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [bookId, topicId]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!topic) {
    return (
      <View style={styles.centered}>
        <Text style={styles.missing}>This topic hasn’t been generated yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <TopicRenderer topic={topic} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  missing: { color: colors.textSecondary, fontSize: typography.sizeMd, textAlign: "center" },
});
