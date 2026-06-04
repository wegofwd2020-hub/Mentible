import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { submitGenerate } from "@/api/client";
import { loadApiKey } from "@/secure/keyStore";
import { loadLastLesson } from "@/storage/lessonStore";
import { loadDefaultParams } from "@/storage/settingsStore";
import { GenerationParamsEditor } from "@/components/GenerationParamsEditor";
import { buildGenerateRequest } from "@/lib/buildGenerateRequest";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { DEFAULT_GENERATION_PARAMS, type GenerationParams } from "@/types/generationParams";
import type { StoredLesson } from "@/storage/lessonStore";

export default function HomeScreen() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [params, setParams] = useState<GenerationParams>(DEFAULT_GENERATION_PARAMS);
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

  // Seed the one-off Query params from the saved global default (once).
  useEffect(() => {
    let m = true;
    loadDefaultParams().then((p) => {
      if (m) setParams(p);
    });
    return () => {
      m = false;
    };
  }, []);

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
      const res = await submitGenerate(
        buildGenerateRequest({ topic: trimmedTopic, apiKey, params }),
      );
      router.push(`/lesson/${res.job_id}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not reach server";
      setErrorMsg(message);
    } finally {
      if (isMounted.current) setSubmitting(false);
    }
  }, [topic, params, router]);

  const canGenerate = topic.trim().length > 0 && !submitting;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero} accessibilityRole="header">
          <View style={styles.logoCard}>
            <Image
              source={require("../../assets/brand/mentible-lockup-redorange-white.png")}
              style={styles.logo}
              resizeMode="contain"
              accessibilityLabel="Mentible — Author Yourself"
            />
          </View>
        </View>

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

        <GenerationParamsEditor
          value={params}
          onChange={setParams}
          pagesLabel="Length (pages)"
          pagesHint="Approximate pages for this lesson. 0 = no limit."
        />

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
            <Text style={styles.lastLessonTitle}>Continue</Text>
            <Text style={styles.lastLessonTopic}>{lastLesson.lesson.topic}</Text>
            <Text style={styles.lastLessonMeta}>
              {lastLesson.lesson.level} ·{" "}
              {new Date(lastLesson.savedAt).toLocaleDateString()}
            </Text>
            <Pressable
              style={styles.viewBtn}
              onPress={() => router.push(`/lesson/${lastLesson.jobId}`)}
              accessibilityRole="button"
              accessibilityLabel="Continue last lesson"
            >
              <Text style={styles.viewBtnText}>Continue →</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    padding: spacing.md,
    gap: spacing.md,
  },
  hero: {
    alignItems: "center",
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  // The logo is dark-on-transparent (made for light backgrounds), so sit it on
  // a light rounded card to stay legible on the dark UI. alignSelf:center keeps
  // the card shrink-wrapped to the logo rather than stretching full-width.
  logoCard: {
    alignSelf: "center",
    backgroundColor: "#ffffff",
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  logo: {
    width: 200,
    height: 200,
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
