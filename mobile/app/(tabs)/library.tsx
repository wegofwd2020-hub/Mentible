import React, { useCallback, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { deleteLesson, loadLibrary, type LessonMeta } from "@/storage/lessonStore";
import { colors, radius, spacing, typography } from "@/constants/theme";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function LevelBadge({ level }: { level: string }) {
  const label = level.charAt(0).toUpperCase() + level.slice(1);
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

export default function LibraryScreen() {
  const router = useRouter();
  const [lessons, setLessons] = useState<LessonMeta[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadLibrary().then(setLessons);
    }, []),
  );

  const handleDelete = useCallback(async (jobId: string) => {
    await deleteLesson(jobId);
    setLessons((prev) => prev.filter((m) => m.jobId !== jobId));
  }, []);

  if (lessons.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>📚</Text>
        <Text style={styles.emptyTitle}>No saved lessons</Text>
        <Text style={styles.emptyBody}>
          Generate a lesson on the Query tab — it will appear here automatically.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={lessons}
      keyExtractor={(item) => item.jobId}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      renderItem={({ item }) => (
        <Pressable
          style={styles.card}
          onPress={() => router.push(`/lesson/${item.jobId}`)}
          accessibilityRole="button"
          accessibilityLabel={`Open lesson: ${item.topic}`}
        >
          <View style={styles.cardMain}>
            <Text style={styles.topic} numberOfLines={2}>{item.topic}</Text>
            <View style={styles.meta}>
              <LevelBadge level={item.level} />
              <Text style={styles.date}>{formatDate(item.savedAt)}</Text>
            </View>
          </View>
          <Pressable
            style={styles.deleteBtn}
            onPress={() => handleDelete(item.jobId)}
            accessibilityRole="button"
            accessibilityLabel={`Delete lesson: ${item.topic}`}
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
  list: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    padding: spacing.md,
  },
  separator: {
    height: spacing.sm,
  },
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
  cardMain: {
    flex: 1,
    gap: spacing.xs,
  },
  topic: {
    fontSize: typography.sizeMd,
    fontWeight: "700",
    color: colors.text,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  badge: {
    backgroundColor: colors.primary + "33",
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: typography.sizeXs,
    fontWeight: "600",
    color: colors.primary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  date: {
    fontSize: typography.sizeXs,
    color: colors.textMuted,
  },
  deleteBtn: {
    padding: spacing.xs,
  },
  deleteIcon: {
    fontSize: 18,
  },
  empty: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  emptyIcon: {
    fontSize: 48,
  },
  emptyTitle: {
    fontSize: typography.sizeLg,
    fontWeight: "700",
    color: colors.text,
  },
  emptyBody: {
    fontSize: typography.sizeSm,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 22,
    maxWidth: 280,
  },
});
