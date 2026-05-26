import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { submitStructure } from "@/api/client";
import { useStructureJob } from "@/hooks/useStructureJob";
import { loadApiKey } from "@/secure/keyStore";
import { ensureTopicIds } from "@/storage/bookStore";
import { BookEditor } from "@/components/BookEditor";
import { colors, radius, spacing, typography } from "@/constants/theme";

function randomRequestId(): string {
  return crypto.randomUUID();
}

type Phase = "input" | "submitted";

export default function NewBookScreen() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [rawToc, setRawToc] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [jobId, setJobId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { status, toc, error, elapsed } = useStructureJob(
    phase === "submitted" ? jobId : null,
  );

  const handleStructure = useCallback(async () => {
    const trimmedToc = rawToc.trim();
    if (!trimmedToc) return;
    setErrorMsg(null);

    const apiKey = await loadApiKey();
    if (!apiKey) {
      setErrorMsg("No API key saved. Go to Settings and paste your Anthropic key.");
      return;
    }

    try {
      const res = await submitStructure({
        request_id: randomRequestId(),
        raw_toc: trimmedToc,
        api_key: apiKey,
      });
      setJobId(res.job_id);
      setPhase("submitted");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not reach server");
    }
  }, [rawToc]);

  const canStructure = rawToc.trim().length > 0;

  // ── Submitted: derive the view from the structure job state ────────────────
  if (phase === "submitted") {
    // Done → the editable topic tree.
    if (status === "done" && toc) {
      return (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <BookEditor
            bookId={null}
            initialTitle={title.trim() || "Untitled book"}
            initialToc={ensureTopicIds(toc)}
            onSaved={() => router.replace("/books")}
          />
        </ScrollView>
      );
    }

    // Failed → error + back to input.
    if (status === "failed" || error) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Couldn’t structure that</Text>
          <Text style={styles.errorBody}>{error ?? "Structuring failed"}</Text>
          <Pressable
            style={styles.retryBtn}
            onPress={() => {
              setPhase("input");
              setJobId(null);
            }}
            accessibilityRole="button"
            accessibilityLabel="Back to editing the table of contents"
          >
            <Text style={styles.retryBtnText}>← Edit and try again</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.structuringText}>Structuring your table of contents…</Text>
        <Text style={styles.structuringMeta}>{elapsed}s</Text>
      </View>
    );
  }

  // ── Input phase ─────────────────────────────────────────────────────────────
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.label}>Book title (optional)</Text>
      <TextInput
        style={styles.titleInput}
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. My Physics Primer"
        placeholderTextColor={colors.textMuted}
        maxLength={200}
        accessibilityLabel="Book title"
      />

      <Text style={styles.label}>Paste a table of contents</Text>
      <Text style={styles.hint}>
        A rough outline, syllabus, or textbook index. We’ll turn it into an
        editable topic tree — you stay in control of the result.
      </Text>
      <TextInput
        style={styles.tocInput}
        value={rawToc}
        onChangeText={setRawToc}
        placeholder={
          "Physics\n- Kinematics: speed, velocity, acceleration\n- Dynamics: Newton's laws, friction\n..."
        }
        placeholderTextColor={colors.textMuted}
        multiline
        textAlignVertical="top"
        accessibilityLabel="Table of contents input"
      />

      {errorMsg && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{errorMsg}</Text>
        </View>
      )}

      <Pressable
        style={[styles.structureBtn, !canStructure && styles.structureBtnDisabled]}
        onPress={handleStructure}
        disabled={!canStructure}
        accessibilityRole="button"
        accessibilityLabel="Structure table of contents"
        accessibilityState={{ disabled: !canStructure }}
      >
        <Text style={styles.structureBtnText}>Structure →</Text>
      </Pressable>
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
    gap: spacing.sm,
    padding: spacing.xl,
  },
  label: {
    fontSize: typography.sizeSm,
    fontWeight: "600",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: spacing.sm,
  },
  hint: { color: colors.textMuted, fontSize: typography.sizeSm },
  titleInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: typography.sizeLg,
    fontWeight: "700",
  },
  tocInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: typography.sizeMd,
    minHeight: 180,
  },
  errorBanner: {
    backgroundColor: colors.error + "22",
    borderColor: colors.error + "66",
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorBannerText: { color: colors.error, fontSize: typography.sizeSm },
  structureBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    marginTop: spacing.md,
  },
  structureBtnDisabled: { opacity: 0.45 },
  structureBtnText: { color: colors.primaryText, fontSize: typography.sizeMd, fontWeight: "700" },
  structuringText: {
    color: colors.text,
    fontSize: typography.sizeMd,
    textAlign: "center",
    marginTop: spacing.md,
  },
  structuringMeta: { color: colors.textMuted, fontSize: typography.sizeSm },
  errorTitle: { color: colors.error, fontSize: typography.sizeLg, fontWeight: "700" },
  errorBody: { color: colors.textSecondary, fontSize: typography.sizeSm, textAlign: "center" },
  retryBtn: { marginTop: spacing.md },
  retryBtnText: { color: colors.primary, fontWeight: "600", fontSize: typography.sizeMd },
});
