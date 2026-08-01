import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { ApiError, submitStructure } from "@/api/client";
import { demoBlocked } from "@/constants/demo";
import { useStructureJob } from "@/hooks/useStructureJob";
import { loadApiKey } from "@/secure/keyStore";
import { ensureTopicIds } from "@/storage/bookStore";
import { pickTocFileContents } from "@/storage/pickBookFile";
import { downloadTextArtifact } from "@/storage/epubLibrary";
import { BOOK_OUTLINE_TEMPLATE } from "@/constants/bookOutlineTemplate";
import { randomUUID } from "@/lib/uuid";
import { BookEditor } from "@/components/BookEditor";
import { PageContainer } from "@/components/PageContainer";
import { useResponsive } from "@/hooks/useResponsive";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";
import { RequireSignIn } from "@/auth/RequireSignIn";

function randomRequestId(): string {
  return randomUUID();
}

// If the markdown opens with an H1 (`# Title`), use it as a suggested book
// title. Stops at the first non-blank line so a body paragraph isn't mistaken
// for a heading.
function firstHeading(md: string): string | null {
  for (const line of md.split("\n")) {
    const m = line.match(/^#\s+(.+?)\s*#*\s*$/);
    if (m) return m[1].trim();
    if (line.trim()) break;
  }
  return null;
}

type Phase = "input" | "submitted";

export default function NewBookScreen() {
  return (
    <RequireSignIn action="create a book">
      <NewBookScreenInner />
    </RequireSignIn>
  );
}

function NewBookScreenInner() {
  const router = useRouter();
  const { isDesktop } = useResponsive();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [title, setTitle] = useState("");
  const [rawToc, setRawToc] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [jobId, setJobId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [templateMsg, setTemplateMsg] = useState<string | null>(null);

  const { status, toc, error, elapsed } = useStructureJob(
    phase === "submitted" ? jobId : null,
  );

  const handleStructure = useCallback(async () => {
    if (demoBlocked()) return;
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
      setErrorMsg(
        err instanceof ApiError
          ? err.userMessage()
          : err instanceof Error
            ? err.message
            : "Could not reach server",
      );
    }
  }, [rawToc]);

  // Load the TOC from a Markdown/text file instead of pasting it — easier than
  // hand-pasting a long local outline. Fills the title from the file's first H1
  // when the title field is still empty.
  const handleLoadFile = useCallback(async () => {
    setErrorMsg(null);
    setPicking(true);
    try {
      const contents = await pickTocFileContents();
      if (contents == null) return; // user cancelled
      if (!contents.trim()) {
        setErrorMsg("That file was empty.");
        return;
      }
      setRawToc(contents);
      setTitle((cur) => (cur.trim() ? cur : firstHeading(contents) ?? cur));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setPicking(false);
    }
  }, []);

  // Hand the user a blank outline to fill out offline and re-upload via the
  // "Load from a Markdown file" button above.
  const handleDownloadTemplate = useCallback(async () => {
    setErrorMsg(null);
    try {
      const res = await downloadTextArtifact(
        BOOK_OUTLINE_TEMPLATE,
        "book-outline-template.md",
        "text/markdown",
      );
      setTemplateMsg(res.savedPath ? `Saved: ${res.savedPath}` : "Template downloaded.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not download the template.");
    }
  }, []);

  const canStructure = rawToc.trim().length > 0;

  // ── Submitted: derive the view from the structure job state ────────────────
  if (phase === "submitted") {
    // Done → the editable topic tree.
    if (status === "done" && toc) {
      return (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <PageContainer>
            <BookEditor
              bookId={null}
              initialTitle={title.trim() || "Untitled book"}
              initialToc={ensureTopicIds(toc)}
              onSaved={() => router.replace("/books")}
            />
          </PageContainer>
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
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={styles.structuringText}>Structuring your table of contents…</Text>
        <Text style={styles.structuringMeta}>{elapsed}s</Text>
      </View>
    );
  }

  // ── Input phase ─────────────────────────────────────────────────────────────
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <PageContainer gap={spacing.sm}>
      <Text style={styles.label}>Book title (optional)</Text>
      <TextInput
        style={styles.titleInput}
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. My Physics Primer"
        placeholderTextColor={theme.textMuted}
        maxLength={200}
        accessibilityLabel="Book title"
      />

      <Text style={styles.label}>Table of contents</Text>
      <Text style={styles.hint}>
        A rough outline, syllabus, or textbook index. Load it from a Markdown
        file or paste it below — we’ll turn it into an editable topic tree, and
        you stay in control of the result.
      </Text>

      <Pressable
        style={styles.loadBtn}
        onPress={handleLoadFile}
        disabled={picking}
        accessibilityRole="button"
        accessibilityLabel="Load table of contents from a Markdown file"
        accessibilityState={{ disabled: picking }}
      >
        {picking ? (
          <ActivityIndicator size="small" color={theme.primary} />
        ) : (
          <Text style={styles.loadBtnText}>📄 Load from a Markdown file</Text>
        )}
      </Pressable>

      <Pressable
        onPress={handleDownloadTemplate}
        accessibilityRole="button"
        accessibilityLabel="Download a blank Markdown outline template"
        hitSlop={8}
      >
        <Text style={styles.templateLink}>↓ Download a blank template (.md)</Text>
      </Pressable>
      {templateMsg && <Text style={styles.templateMsg}>✓ {templateMsg}</Text>}

      <TextInput
        style={[styles.tocInput, isDesktop && styles.tocInputDesktop]}
        value={rawToc}
        onChangeText={setRawToc}
        placeholder={
          "Physics\n- Kinematics: speed, velocity, acceleration\n- Dynamics: Newton's laws, friction\n..."
        }
        placeholderTextColor={theme.textMuted}
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
      </PageContainer>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) => ({
  scroll: { flex: 1, backgroundColor: c.background },
  scrollContent: { flexGrow: 1 },
  tocInputDesktop: { minHeight: 300 },
  centered: {
    flex: 1 as const,
    backgroundColor: c.background,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: spacing.sm,
    padding: spacing.xl,
  },
  label: {
    fontSize: typography.sizeSm,
    fontWeight: "600" as const,
    color: c.textSecondary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.8,
    marginTop: spacing.sm,
  },
  hint: { color: c.textMuted, fontSize: typography.sizeSm },
  loadBtn: {
    borderColor: c.primary,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center" as const,
    marginTop: spacing.xs,
  },
  loadBtnText: { color: c.primary, fontSize: typography.sizeMd, fontWeight: "700" as const },
  templateLink: {
    color: c.textSecondary,
    fontSize: typography.sizeSm,
    fontWeight: "600" as const,
    textAlign: "center" as const,
    marginTop: spacing.xs,
  },
  templateMsg: { color: c.success, fontSize: typography.sizeXs, textAlign: "center" as const },
  titleInput: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: c.text,
    fontSize: typography.sizeLg,
    fontWeight: "700" as const,
  },
  tocInput: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: c.text,
    fontSize: typography.sizeMd,
    minHeight: 180,
  },
  errorBanner: {
    backgroundColor: c.error + "22",
    borderColor: c.error + "66",
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorBannerText: { color: c.error, fontSize: typography.sizeSm },
  structureBtn: {
    backgroundColor: c.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center" as const,
    marginTop: spacing.md,
  },
  structureBtnDisabled: { opacity: 0.45 },
  structureBtnText: { color: c.primaryText, fontSize: typography.sizeMd, fontWeight: "700" as const },
  structuringText: {
    color: c.text,
    fontSize: typography.sizeMd,
    textAlign: "center" as const,
    marginTop: spacing.md,
  },
  structuringMeta: { color: c.textMuted, fontSize: typography.sizeSm },
  errorTitle: { color: c.error, fontSize: typography.sizeLg, fontWeight: "700" as const },
  errorBody: { color: c.textSecondary, fontSize: typography.sizeSm, textAlign: "center" as const },
  retryBtn: { marginTop: spacing.md },
  retryBtnText: { color: c.primary, fontWeight: "600" as const, fontSize: typography.sizeMd },
});
