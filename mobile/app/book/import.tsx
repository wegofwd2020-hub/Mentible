import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { importBook } from "@/storage/importBook";
import { pickBookFileContents } from "@/storage/pickBookFile";
import { PageContainer } from "@/components/PageContainer";
import { useResponsive } from "@/hooks/useResponsive";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { RequireSignIn } from "@/auth/RequireSignIn";

// Import a book exported elsewhere (e.g. a migrated book.json from the OnDemand
// Authoring Studio). Paste-based to match the app's existing "paste a TOC" flow
// and avoid a native file-picker dependency.
export default function ImportBookScreen() {
  return (
    <RequireSignIn action="import a book">
      <ImportBookScreenInner />
    </RequireSignIn>
  );
}

function ImportBookScreenInner() {
  const router = useRouter();
  const { isDesktop } = useResponsive();
  const [raw, setRaw] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canImport = raw.trim().length > 0 && !busy;

  const runImport = useCallback(
    async (contents: string) => {
      setErrorMsg(null);
      setBusy(true);
      try {
        const book = await importBook(contents);
        router.replace(`/book/saved/${book.id}`);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Couldn’t import that book.");
        setBusy(false);
      }
    },
    [router],
  );

  const handlePasteImport = useCallback(() => {
    if (raw.trim()) void runImport(raw);
  }, [raw, runImport]);

  const handleFileImport = useCallback(async () => {
    setErrorMsg(null);
    let contents: string | null;
    try {
      contents = await pickBookFileContents();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Couldn’t read that file.");
      return;
    }
    if (contents != null) void runImport(contents);
  }, [runImport]);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <PageContainer gap={spacing.sm}>
        <Text style={styles.label}>Import a book</Text>
        <Text style={styles.hint}>
          Open a book’s JSON file (for example, one exported from the Authoring
          Studio). It’s saved to this device’s library — nothing is uploaded.
        </Text>

        <Pressable
          style={[styles.importBtn, busy && styles.importBtnDisabled]}
          onPress={handleFileImport}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Choose a JSON file to import"
          accessibilityState={{ disabled: busy }}
        >
          <Text style={styles.importBtnText}>Choose a JSON file</Text>
        </Pressable>

        <Text style={styles.orHint}>or paste the JSON directly (best for small books):</Text>
        <TextInput
          style={[styles.input, isDesktop && styles.inputDesktop]}
          value={raw}
          onChangeText={setRaw}
          placeholder={'{\n  "title": "…",\n  "toc": { "subjects": [ … ] },\n  "content": { … }\n}'}
          placeholderTextColor={colors.textMuted}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          textAlignVertical="top"
          accessibilityLabel="Book JSON input"
        />

        {errorMsg && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{errorMsg}</Text>
          </View>
        )}

        <Pressable
          style={[styles.pasteBtn, !canImport && styles.importBtnDisabled]}
          onPress={handlePasteImport}
          disabled={!canImport}
          accessibilityRole="button"
          accessibilityLabel="Import pasted book JSON"
          accessibilityState={{ disabled: !canImport }}
        >
          <Text style={styles.pasteBtnText}>{busy ? "Importing…" : "Import pasted JSON"}</Text>
        </Pressable>
      </PageContainer>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1 },
  label: {
    fontSize: typography.sizeSm,
    fontWeight: "600",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: spacing.sm,
  },
  hint: { color: colors.textMuted, fontSize: typography.sizeSm },
  orHint: { color: colors.textMuted, fontSize: typography.sizeSm, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: typography.sizeMd,
    fontFamily: "Menlo",
    minHeight: 200,
  },
  inputDesktop: { minHeight: 320 },
  errorBanner: {
    backgroundColor: colors.error + "22",
    borderColor: colors.error + "66",
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorBannerText: { color: colors.error, fontSize: typography.sizeSm },
  importBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    marginTop: spacing.md,
  },
  importBtnDisabled: { opacity: 0.45 },
  importBtnText: { color: colors.primaryText, fontSize: typography.sizeMd, fontWeight: "700" },
  pasteBtn: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    marginTop: spacing.md,
  },
  pasteBtnText: { color: colors.textSecondary, fontSize: typography.sizeSm, fontWeight: "600" },
});
