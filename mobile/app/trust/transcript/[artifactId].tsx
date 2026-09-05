import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { RequireSignIn } from "@/auth/RequireSignIn";
import { useAuth } from "@/auth/AuthProvider";
import { getTranscriptVersion, type TranscriptVersionDetail } from "@/api/trustClient";
import { useTrustProject } from "@/hooks/useTrustProject";
import { ApiError } from "@/api/client";
import { Alert } from "@/lib/alert";
import { IS_DEMO } from "@/constants/demo";
import {
  toEditable,
  updateSegment,
  orderLowConfidenceFirst,
  confidenceTone,
  segmentsForSave,
  speakerNames,
  type ConfidenceTone,
  type EditableSegment,
} from "@/lib/transcriptSegments";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import { useTheme, useThemedStyles } from "@/theme";

type Styles = ReturnType<typeof makeStyles>;

function toneColor(tone: ConfidenceTone, c: Palette): string {
  // Segment-level shading: a left stripe. Low confidence stands out (needs
  // review), high fades into the surface.
  if (tone === "low") return c.error;
  if (tone === "medium") return c.textSecondary;
  return c.border;
}

function TranscriptReviewInner() {
  const { artifactId, versionId, projectId } = useLocalSearchParams<{
    artifactId: string;
    versionId: string;
    projectId: string;
  }>();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { accessToken } = useAuth();
  const { approve, unapprove, addVersion } = useTrustProject(String(projectId));

  const [version, setVersion] = useState<TranscriptVersionDetail | null>(null);
  const [segments, setSegments] = useState<EditableSegment[]>([]);
  const [currentVersionId, setCurrentVersionId] = useState(String(versionId));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [apBusy, setApBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lowFirst, setLowFirst] = useState(true);

  const load = useCallback(
    async (vid: string) => {
      if (!accessToken) return;
      setLoading(true);
      setError(null);
      try {
        const v = await getTranscriptVersion(vid, accessToken);
        setVersion(v);
        setSegments(toEditable(v.content.segments));
        setCurrentVersionId(v.id);
        setDirty(false);
      } catch (e) {
        setError(e instanceof ApiError ? e.userMessage() : "Couldn't load this transcript.");
      } finally {
        setLoading(false);
      }
    },
    [accessToken],
  );

  useEffect(() => {
    void load(String(versionId));
  }, [load, versionId]);

  const onEditText = (key: string, text: string) => {
    setSegments((list) => updateSegment(list, key, { text }));
    setDirty(true);
  };
  const onEditSpeaker = (key: string, speaker: string) => {
    setSegments((list) => updateSegment(list, key, { speaker }));
    setDirty(true);
  };
  const onAssignSpeaker = (key: string, name: string) => {
    setSegments((list) => updateSegment(list, key, { speaker: name }));
    setDirty(true);
  };

  const knownSpeakers = useMemo(() => speakerNames(segments), [segments]);
  const displayed = useMemo(
    () => (lowFirst ? orderLowConfidenceFirst(segments) : segments),
    [lowFirst, segments],
  );

  const onSave = () => {
    if (!version || saving) return;
    setSaving(true);
    void (async () => {
      try {
        const created = await addVersion(String(artifactId), segmentsForSave(segments, version.content));
        // The saved edits are a new immutable version; point the view at it.
        await load(created.id);
        Alert.alert("Saved", "A new transcript version was created. Approve it when it's ready.");
      } catch (e) {
        Alert.alert("Couldn't save", e instanceof ApiError ? e.userMessage() : "Please try again.");
      } finally {
        setSaving(false);
      }
    })();
  };

  const onApprove = () => {
    setApBusy(true);
    void (async () => {
      try {
        await approve(currentVersionId);
        await load(currentVersionId);
      } catch (e) {
        Alert.alert("Couldn't approve", e instanceof ApiError ? e.userMessage() : "Please try again.");
      } finally {
        setApBusy(false);
      }
    })();
  };

  const onUnapprove = () => {
    setApBusy(true);
    void (async () => {
      try {
        await unapprove(currentVersionId);
        await load(currentVersionId);
      } catch (e) {
        Alert.alert("Couldn't withdraw", e instanceof ApiError ? e.userMessage() : "Please try again.");
      } finally {
        setApBusy(false);
      }
    })();
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
      <PageContainer>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.primary} />
          </View>
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : version ? (
          <>
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.title}>Transcript v{version.version_no}</Text>
                <Text style={styles.provenance}>
                  {version.content.language.toUpperCase()}
                  {version.content.stt_meta?.model ? ` · ${version.content.stt_meta.model}` : ""}
                </Text>
              </View>
              {version.is_validated ? (
                <View style={styles.badgeRow}>
                  <Text accessibilityLabel={`Version ${version.version_no} validated`} style={styles.chip}>Validated ✓</Text>
                  {version.recorded_via === "expert_self" ? (
                    <Text style={styles.provChip}>expert-validated</Text>
                  ) : version.recorded_via === "operator" ? (
                    <Text style={styles.provChip}>operator-recorded</Text>
                  ) : null}
                </View>
              ) : null}
            </View>

            <View style={styles.actionsRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: lowFirst }}
                accessibilityLabel="Low-confidence first"
                style={[styles.toggleBtn, lowFirst && styles.toggleBtnActive]}
                onPress={() => setLowFirst((v) => !v)}
              >
                <Text style={[styles.toggleText, lowFirst && styles.toggleTextActive]}>Low-confidence first</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save transcript"
                disabled={!dirty || saving}
                style={[styles.approveBtn, (!dirty || saving) && styles.disabled]}
                onPress={onSave}
              >
                <Text style={styles.approveText}>{saving ? "Saving…" : "Save"}</Text>
              </Pressable>
              {version.is_validated ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Withdraw approval of version ${version.version_no}`} disabled={apBusy} style={styles.unapproveBtn} onPress={onUnapprove}>
                  <Text style={styles.unapproveText}>{apBusy ? "…" : "Unapprove"}</Text>
                </Pressable>
              ) : (
                <Pressable accessibilityRole="button" accessibilityLabel={`Approve version ${version.version_no}`} disabled={apBusy || dirty} style={[styles.approveBtn, (apBusy || dirty) && styles.disabled]} onPress={onApprove}>
                  <Text style={styles.approveText}>{apBusy ? "…" : "Approve"}</Text>
                </Pressable>
              )}
            </View>
            {dirty ? <Text style={styles.hint}>Save your edits before approving.</Text> : null}

            {displayed.map((s) => {
              const tone = confidenceTone(s.confidence);
              return (
                <View key={s.key} style={[styles.segment, { borderLeftColor: toneColor(tone, theme) }]}>
                  <View style={styles.segMetaRow}>
                    <Text style={styles.segMeta}>
                      {s.confidence == null ? "confidence —" : `confidence ${Math.round(s.confidence * 100)}%`}
                    </Text>
                    {tone === "low" ? <Text style={styles.segFlag}>needs review</Text> : null}
                  </View>
                  <TextInput
                    style={styles.segText}
                    value={s.text}
                    onChangeText={(t) => onEditText(s.key, t)}
                    accessibilityLabel="Segment text"
                    multiline
                  />
                  <TextInput
                    style={styles.speakerInput}
                    value={s.speaker ?? ""}
                    onChangeText={(t) => onEditSpeaker(s.key, t)}
                    placeholder="Speaker (optional)"
                    placeholderTextColor={theme.textMuted}
                    accessibilityLabel="Segment speaker"
                  />
                  {knownSpeakers.length > 0 ? (
                    <View style={styles.chipRow}>
                      {knownSpeakers.map((name) => (
                        <Pressable
                          key={name}
                          accessibilityRole="button"
                          accessibilityLabel={`Tag speaker ${name}`}
                          style={[styles.speakerChip, s.speaker === name && styles.speakerChipActive]}
                          onPress={() => onAssignSpeaker(s.key, name)}
                        >
                          <Text style={[styles.speakerChipText, s.speaker === name && styles.speakerChipTextActive]}>{name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </>
        ) : null}
      </PageContainer>
    </ScrollView>
  );
}

export default function TranscriptReview() {
  if (IS_DEMO) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ textAlign: "center" }}>Transcript review isn&apos;t available in the demo build.</Text>
      </View>
    );
  }
  return (
    <RequireSignIn action="review a transcript">
      <TranscriptReviewInner />
    </RequireSignIn>
  );
}

const makeStyles = (c: Palette) => ({
  scroll: { flex: 1 as const, backgroundColor: "transparent" },
  body: { padding: spacing.md, gap: spacing.md },
  center: { flex: 1 as const, alignItems: "center" as const, justifyContent: "center" as const, padding: spacing.xl },
  headerRow: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
  title: { color: c.text, fontSize: typography.sizeXxl, fontFamily: FRAUNCES.bold, letterSpacing: -0.56 },
  provenance: { color: c.textMuted, fontSize: typography.sizeSm, marginTop: 2 },
  badgeRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs },
  chip: { color: c.primaryText, backgroundColor: c.primary, fontSize: typography.sizeSm, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 as const },
  provChip: { color: c.textMuted, fontSize: typography.sizeSm, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 as const },
  actionsRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: spacing.sm },
  toggleBtn: { borderWidth: 1, borderColor: c.border, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  toggleBtnActive: { backgroundColor: c.primary, borderColor: c.primary },
  toggleText: { color: c.textSecondary, fontSize: typography.sizeSm, fontWeight: "600" as const },
  toggleTextActive: { color: c.primaryText },
  approveBtn: { backgroundColor: c.primary, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  approveText: { color: c.primaryText, fontSize: typography.sizeSm, fontWeight: "700" as const },
  unapproveBtn: { borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  unapproveText: { color: c.textSecondary, fontSize: typography.sizeSm },
  disabled: { opacity: 0.5 },
  hint: { color: c.textMuted, fontSize: typography.sizeSm },
  segment: {
    backgroundColor: c.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    borderLeftWidth: 4,
    padding: spacing.md,
    gap: spacing.sm,
  },
  segMetaRow: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
  segMeta: { color: c.textMuted, fontSize: typography.sizeSm },
  segFlag: { color: c.error, fontSize: typography.sizeSm, fontWeight: "600" as const },
  segText: { color: c.text, fontSize: typography.sizeMd, lineHeight: 22 as const, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, padding: spacing.sm },
  speakerInput: { color: c.text, fontSize: typography.sizeSm, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, padding: spacing.sm },
  chipRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: spacing.xs },
  speakerChip: { borderWidth: 1, borderColor: c.border, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 as const },
  speakerChipActive: { backgroundColor: c.primary, borderColor: c.primary },
  speakerChipText: { color: c.textSecondary, fontSize: typography.sizeSm },
  speakerChipTextActive: { color: c.primaryText },
  error: { color: c.error, fontSize: typography.sizeMd },
  backBtn: { alignSelf: "flex-start" as const, paddingVertical: spacing.sm },
  backText: { color: c.primary, fontSize: typography.sizeMd },
});
