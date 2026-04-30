import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { submitGenerate } from "@/api/client";
import { loadApiKey } from "@/secure/keyStore";
import { loadLastLesson } from "@/storage/lessonStore";
import { LevelPicker } from "@/components/LevelPicker";
import { DEFAULT_LEVEL } from "@/constants/levels";
import { colors, radius, spacing, typography } from "@/constants/theme";
import type { StoredLesson } from "@/storage/lessonStore";

function randomRequestId(): string {
  return crypto.randomUUID();
}

export default function HomeScreen() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState(DEFAULT_LEVEL);
  const [submitting, setSubmitting] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [lastLesson, setLastLesson] = useState<StoredLesson | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const isMounted = useRef(true);

  useFocusEffect(
    useCallback(() => {
      isMounted.current = true;
      (async () => {
        const [key, stored] = await Promise.all([
          loadApiKey(),
          loadLastLesson(),
        ]);
        if (!isMounted.current) return;
        setHasKey(key !== null);
        setLastLesson(stored);
      })();
      return () => {
        isMounted.current = false;
      };
    }, []),
  );

  const handleGenerate = useCallback(async () => {
    const trimmedTopic = topic.trim();
    if (!trimmedTopic) return;

    setErrorMsg(null);

    const apiKey = await loadApiKey();
    if (!apiKey) {
      setErrorMsg("No API key saved. Go to Settings and paste your Anthropic key.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await submitGenerate({
        request_id: randomRequestId(),
        topic: trimmedTopic,
        level,
        language: "en",
        format: "lesson",
        depth: "standard",
        api_key: apiKey,
      });
      router.push(`/lesson/${res.job_id}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not reach server";
      setErrorMsg(message);
    } finally {
      if (isMounted.current) setSubmitting(false);
    }
  }, [topic, level, router]);

  const canGenerate = topic.trim().length > 0 && !submitting;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      {hasKey === false && (
        <Pressable
          style={styles.keyBanner}
          onPress={() => router.push("/settings")}
          accessibilityRole="button"
          accessibilityLabel="API key not set — tap to open Settings"
        >
          <Text style={styles.keyBannerText}>
            No API key set.{" "}
            <Text style={styles.keyBannerLink}>Open Settings →</Text>
          </Text>
        </Pressable>
      )}

      <Text style={styles.label}>What do you want to learn?</Text>
      <TextInput
        style={styles.topicInput}
        placeholder="e.g. Quadratic formula, TCP three-way handshake, photosynthesis..."
        placeholderTextColor={colors.textMuted}
        value={topic}
        onChangeText={setTopic}
        multiline
        maxLength={200}
        returnKeyType="done"
        blurOnSubmit
        accessibilityLabel="Topic input"
      />

      <Text style={styles.label}>Level</Text>
      <LevelPicker value={level} onChange={setLevel} />

      {errorMsg && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{errorMsg}</Text>
        </View>
      )}

      <Pressable
        style={[styles.generateBtn, !canGenerate && styles.generateBtnDisabled]}
        onPress={handleGenerate}
        disabled={!canGenerate}
        accessibilityRole="button"
        accessibilityLabel="Generate lesson"
        accessibilityState={{ disabled: !canGenerate }}
      >
        {submitting ? (
          <ActivityIndicator color={colors.primaryText} />
        ) : (
          <Text style={styles.generateBtnText}>Generate lesson</Text>
        )}
      </Pressable>

      {lastLesson && (
        <View style={styles.lastLessonCard}>
          <Text style={styles.lastLessonTitle}>Last lesson</Text>
          <Text style={styles.lastLessonTopic}>{lastLesson.lesson.topic}</Text>
          <Text style={styles.lastLessonMeta}>
            {lastLesson.lesson.level} ·{" "}
            {new Date(lastLesson.savedAt).toLocaleDateString()}
          </Text>
          <Pressable
            style={styles.viewBtn}
            onPress={() => router.push(`/lesson/${lastLesson.jobId}`)}
            accessibilityRole="button"
            accessibilityLabel="View last lesson"
          >
            <Text style={styles.viewBtnText}>View →</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    padding: spacing.md,
    gap: spacing.md,
  },
  keyBanner: {
    backgroundColor: colors.warning + "22",
    borderColor: colors.warning + "66",
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  keyBannerText: {
    color: colors.warning,
    fontSize: typography.sizeSm,
  },
  keyBannerLink: {
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  label: {
    fontSize: typography.sizeSm,
    fontWeight: "600",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  topicInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: typography.sizeMd,
    minHeight: 90,
    textAlignVertical: "top",
  },
  errorBanner: {
    backgroundColor: colors.error + "22",
    borderColor: colors.error + "66",
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorBannerText: {
    color: colors.error,
    fontSize: typography.sizeSm,
  },
  generateBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  generateBtnDisabled: {
    opacity: 0.45,
  },
  generateBtnText: {
    color: colors.primaryText,
    fontSize: typography.sizeMd,
    fontWeight: "700",
  },
  lastLessonCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  lastLessonTitle: {
    fontSize: typography.sizeXs,
    fontWeight: "600",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
  },
  lastLessonTopic: {
    fontSize: typography.sizeMd,
    fontWeight: "700",
    color: colors.text,
  },
  lastLessonMeta: {
    fontSize: typography.sizeSm,
    color: colors.textSecondary,
    marginTop: 4,
  },
  viewBtn: {
    marginTop: spacing.md,
    alignSelf: "flex-start",
  },
  viewBtnText: {
    color: colors.primary,
    fontWeight: "600",
    fontSize: typography.sizeSm,
  },
});
