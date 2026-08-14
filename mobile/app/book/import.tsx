import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { importBook } from "@/storage/importBook";
import { parseBookBundle } from "@/storage/bookBundle";
import { saveBook } from "@/storage/bookStore";
import { pickBookFileOrBundle } from "@/storage/pickBookFile";
import { PageContainer } from "@/components/PageContainer";
import { useResponsive } from "@/hooks/useResponsive";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";
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
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
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
    let picked: Awaited<ReturnType<typeof pickBookFileOrBundle>>;
    try {
      picked = await pickBookFileOrBundle();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Couldn’t read that file.");
      return;
    }
    if (picked == null) return;
    if (picked.kind === "json") {
      void runImport(picked.text);
      return;
    }
    // A `.book.zip` bundle (book has attached images) — parse + persist
    // directly rather than through importBook (which expects JSON text).
    setErrorMsg(null);
    setBusy(true);
    try {
      const book = await parseBookBundle(new Uint8Array(picked.bytes));
      await saveBook(book);
      router.replace(`/book/saved/${book.id}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Couldn’t import that bundle.");
      setBusy(false);
    }
  }, [runImport, router]);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <PageContainer gap={spacing.sm}>
        <Text style={styles.label}>Import a book</Text>
        <Text style={styles.hint}>
          Open a book’s exported file — a .book.json (for example, one exported
          from the Authoring Studio) or a .book.zip bundle (a book with
          attached images). It’s saved to this device’s library — nothing is
          uploaded.
        </Text>

        <Pressable
          style={[styles.importBtn, busy && styles.importBtnDisabled]}
          onPress={handleFileImport}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Choose a book file to import"
          accessibilityState={{ disabled: busy }}
        >
          <Text style={styles.importBtnText}>Choose a book file</Text>
        </Pressable>

        <Text style={styles.orHint}>or paste the JSON directly (best for small books):</Text>
        <TextInput
          style={[styles.input, isDesktop && styles.inputDesktop]}
          value={raw}
          onChangeText={setRaw}
          placeholder={'{\n  "title": "…",\n  "toc": { "subjects": [ … ] },\n  "content": { … }\n}'}
          placeholderTextColor={theme.textMuted}
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

const makeStyles = (c: Palette) => ({
  scroll: { flex: 1, backgroundColor: "transparent" },
  scrollContent: { flexGrow: 1 },
  label: {
    fontSize: typography.sizeSm,
    fontWeight: "600" as const,
    color: c.textSecondary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.8,
    marginTop: spacing.sm,
  },
  hint: { color: c.textMuted, fontSize: typography.sizeSm },
  orHint: { color: c.textMuted, fontSize: typography.sizeSm, marginTop: spacing.sm },
  input: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: c.text,
    fontSize: typography.sizeMd,
    fontFamily: "Menlo",
    minHeight: 200,
  },
  inputDesktop: { minHeight: 320 },
  errorBanner: {
    backgroundColor: c.error + "22",
    borderColor: c.error + "66",
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorBannerText: { color: c.error, fontSize: typography.sizeSm },
  importBtn: {
    backgroundColor: c.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center" as const,
    marginTop: spacing.md,
  },
  importBtnDisabled: { opacity: 0.45 },
  importBtnText: { color: c.primaryText, fontSize: typography.sizeMd, fontWeight: "700" as const },
  pasteBtn: {
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center" as const,
    marginTop: spacing.md,
  },
  pasteBtnText: { color: c.textSecondary, fontSize: typography.sizeSm, fontWeight: "600" as const },
});
