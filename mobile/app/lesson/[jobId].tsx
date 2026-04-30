import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useGenerateJob } from "@/hooks/useGenerateJob";
import { buildHtml, LessonRenderer } from "@/components/LessonRenderer";
import { saveLastLesson } from "@/storage/lessonStore";
import { colors, radius, spacing, typography } from "@/constants/theme";

export default function LessonScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const router = useRouter();
  const { status, lesson, error, elapsed } = useGenerateJob(jobId ?? null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (jobId && lesson) {
      saveLastLesson(jobId, lesson).catch(() => {
        // Best-effort — failure to cache does not break lesson display.
      });
    }
  }, [jobId, lesson]);

  const handleExportPDF = useCallback(async () => {
    if (!lesson) return;
    setExporting(true);
    try {
      const html = buildHtml(lesson);
      if (Platform.OS === "web") {
        // Open the full lesson HTML in a new tab so the browser's print
        // dialog sees the complete page, not just the Expo shell.
        // KaTeX + Mermaid load from CDN in the new tab, then Ctrl+P / Cmd+P
        // (or File → Print) produces a complete PDF.
        const blob = new Blob([html], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        const win = window.open(url, "_blank");
        // Revoke the blob URL after 30 s — long enough for CDN scripts to load.
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
        if (!win) {
          // Popup was blocked — fall back to triggering print on the current page.
          await Print.printAsync({ html });
        }
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        await Sharing.shareAsync(uri, {
          mimeType: "application/pdf",
          dialogTitle: "Save lesson as PDF",
          UTI: "com.adobe.pdf",
        });
      }
    } catch {
      // Silent — user may have cancelled the share/print dialog.
    } finally {
      setExporting(false);
    }
  }, [lesson]);

  if (status === "done" && lesson) {
    return (
      <View style={styles.screen}>
        <View style={styles.toolbar}>
          <Pressable
            style={styles.backBtn}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back to home"
          >
            <Text style={styles.backBtnText}>← Back</Text>
          </Pressable>

          <Pressable
            style={[styles.exportBtn, exporting && styles.exportBtnDisabled]}
            onPress={handleExportPDF}
            disabled={exporting}
            accessibilityRole="button"
            accessibilityLabel="Export lesson as PDF"
          >
            <Text style={styles.exportBtnText}>
              {exporting ? "Preparing…" : "Export PDF"}
            </Text>
          </Pressable>
        </View>

        <LessonRenderer lesson={lesson} />
      </View>
    );
  }

  if (status === "failed" || error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorIcon}>⚠</Text>
        <Text style={styles.errorTitle}>Generation failed</Text>
        <Text style={styles.errorBody}>
          {error ?? "Unknown error. Your Anthropic key was not saved — try again."}
        </Text>
        <Pressable
          style={styles.retryBtn}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back and try again"
        >
          <Text style={styles.retryBtnText}>← Try again</Text>
        </Pressable>
      </View>
    );
  }

  const statusLabel =
    status === "running" ? "Generating…" : "Queued — starting soon…";

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.statusLabel}>{statusLabel}</Text>
      {elapsed > 0 && (
        <Text style={styles.elapsed}>{elapsed}s elapsed</Text>
      )}
      <Text style={styles.hint}>
        This typically takes 30–90 seconds. Stay on this screen.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  backBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  backBtnText: {
    color: colors.primary,
    fontSize: typography.sizeSm,
    fontWeight: "600",
  },
  exportBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  exportBtnDisabled: {
    opacity: 0.5,
  },
  exportBtnText: {
    color: colors.primaryText,
    fontSize: typography.sizeSm,
    fontWeight: "700",
  },
  center: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  statusLabel: {
    fontSize: typography.sizeLg,
    fontWeight: "600",
    color: colors.text,
    textAlign: "center",
  },
  elapsed: {
    fontSize: typography.sizeSm,
    color: colors.textMuted,
  },
  hint: {
    fontSize: typography.sizeSm,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 280,
  },
  errorIcon: {
    fontSize: 48,
  },
  errorTitle: {
    fontSize: typography.sizeLg,
    fontWeight: "700",
    color: colors.error,
  },
  errorBody: {
    fontSize: typography.sizeSm,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 300,
  },
  retryBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  retryBtnText: {
    color: colors.primary,
    fontWeight: "600",
    fontSize: typography.sizeMd,
  },
});
