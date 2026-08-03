import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { useAuth } from "@/auth/AuthProvider";
import { getVersion, type VersionDetailView } from "@/api/trustClient";
import { useTrustProject } from "@/hooks/useTrustProject";
import { ApiError } from "@/api/client";
import { Alert } from "@/lib/alert";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import { SmeThemeScope, useTheme, useThemedStyles } from "@/theme";

type Styles = ReturnType<typeof makeStyles>;

function TrustVersionInner() {
  const { versionId, artifactId, projectId } = useLocalSearchParams<{
    versionId: string; artifactId: string; projectId: string;
  }>();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { accessToken } = useAuth();
  const { project, addVersion } = useTrustProject(String(projectId));
  const [version, setVersion] = useState<VersionDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ heading: string; body: string; source_ids: string[] }[]>([]);
  const [saving, setSaving] = useState(false);
  const isOwner = project?.my_role === "owner";

  useEffect(() => {
    if (!accessToken) return;
    let live = true;
    void (async () => {
      try {
        const v = await getVersion(String(versionId), accessToken);
        if (live) setVersion(v);
      } catch (e) {
        if (live) setError(e instanceof ApiError ? e.userMessage() : "This draft version no longer exists.");
      }
    })();
    return () => { live = false; };
  }, [accessToken, versionId]);

  // input id -> "S1".."Sn", mirroring the backend's label mapping (inputs order).
  const labelFor = useMemo(() => {
    const m = new Map<string, string>();
    (project?.inputs ?? []).forEach((inp, i) => m.set(inp.id, `S${i + 1}`));
    return m;
  }, [project]);

  const startEdit = () => {
    const go = () => { setDraft(version!.content.sections.map((s) => ({ ...s }))); setEditing(true); };
    if (version!.is_validated) {
      Alert.alert(
        "Edit a validated draft?",
        `This creates a new version. The approval on v${version!.version_no} stays; the new version will need re-approval.`,
        [{ text: "Cancel", style: "cancel" }, { text: "Edit", onPress: go }],
      );
    } else { go(); }
  };

  const save = async () => {
    setSaving(true);
    try {
      const v = await addVersion(String(artifactId), { sections: draft });
      router.push({ pathname: "/trust/version/[versionId]", params: { versionId: v.id, artifactId: String(artifactId), projectId: String(projectId) } });
      setEditing(false);
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof ApiError ? e.userMessage() : "Please try again.");
    } finally { setSaving(false); }
  };

  const updateSection = (i: number, field: "heading" | "body", value: string) => {
    setDraft((prev) => prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)));
  };

  const removeSection = (i: number) => {
    setDraft((prev) => prev.filter((_, idx) => idx !== i));
  };

  if (error) return <View style={styles.center}><Text style={styles.error}>{error}</Text></View>;
  if (!version) return <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
      <PageContainer style={{ flex: 1 }}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>v{version.version_no}</Text>
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
          {!editing && isOwner ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Edit draft" style={styles.editBtn} onPress={startEdit}>
              <Text style={styles.editBtnText}>Edit</Text>
            </Pressable>
          ) : null}
        </View>
        {editing ? (
          <>
            {draft.map((s, i) => (
              <View key={i} style={styles.editRow}>
                <TextInput
                  style={styles.input}
                  value={s.heading}
                  onChangeText={(t) => updateSection(i, "heading", t)}
                  accessibilityLabel={`Section ${i + 1} heading`}
                  placeholder="Heading"
                />
                <TextInput
                  style={[styles.input, styles.bodyInput]}
                  value={s.body}
                  onChangeText={(t) => updateSection(i, "body", t)}
                  accessibilityLabel={`Section ${i + 1} body`}
                  placeholder="Body"
                  multiline
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove section ${i + 1}`}
                  style={styles.removeBtn}
                  onPress={() => removeSection(i)}
                >
                  <Text style={styles.removeBtnText}>Remove section</Text>
                </Pressable>
              </View>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add section"
              style={styles.addBtn}
              onPress={() => setDraft([...draft, { heading: "", body: "", source_ids: [] }])}
            >
              <Text style={styles.addBtnText}>Add section</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save as new version"
              style={styles.saveBtn}
              disabled={saving}
              onPress={save}
            >
              <Text style={styles.saveBtnText}>{saving ? "Saving…" : "Save as new version"}</Text>
            </Pressable>
          </>
        ) : (
          version.content.sections.map((s, i) => (
            <View key={i} style={styles.section}>
              <Text style={styles.heading}>{s.heading}</Text>
              <Text style={styles.bodyText}>{s.body}</Text>
              {s.source_ids.length > 0 ? (
                <View style={styles.citeRow}>
                  {s.source_ids.map((id) => (
                    <Text key={id} style={styles.cite}>{labelFor.get(id) ?? "cited"}</Text>
                  ))}
                </View>
              ) : null}
            </View>
          ))
        )}
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </PageContainer>
    </ScrollView>
  );
}

export default function TrustVersion() {
  return (
    <SmeThemeScope>
      <TrustVersionInner />
    </SmeThemeScope>
  );
}

const makeStyles = (c: Palette) => ({
  scroll: { flex: 1 as const },
  body: { padding: spacing.md, gap: spacing.md },
  center: { flex: 1 as const, alignItems: "center" as const, justifyContent: "center" as const, padding: spacing.xl },
  headerRow: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
  title: { color: c.text, fontSize: typography.sizeXxl, fontFamily: FRAUNCES.bold, letterSpacing: -0.56 },
  section: { backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md, gap: spacing.sm },
  heading: { color: c.text, fontSize: typography.sizeLg, fontFamily: FRAUNCES.semibold, letterSpacing: -0.36 },
  bodyText: { color: c.text, fontSize: typography.sizeMd, lineHeight: 22 as const },
  citeRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: spacing.xs },
  cite: { color: c.textMuted, fontSize: typography.sizeSm, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, paddingHorizontal: spacing.xs },
  chip: { color: c.primaryText, backgroundColor: c.primary, fontSize: typography.sizeSm, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 as const },
  badgeRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs },
  provChip: { color: c.textMuted, fontSize: typography.sizeSm, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 as const },
  error: { color: c.error, fontSize: typography.sizeMd },
  backBtn: { alignSelf: "flex-start" as const, paddingVertical: spacing.sm },
  backText: { color: c.primary, fontSize: typography.sizeMd },
  editBtn: { borderWidth: 1, borderColor: c.primary, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  editBtnText: { color: c.primary, fontSize: typography.sizeSm },
  editRow: { backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md, gap: spacing.sm },
  input: { color: c.text, fontSize: typography.sizeMd, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, padding: spacing.sm },
  bodyInput: { minHeight: 80 as const, textAlignVertical: "top" as const },
  removeBtn: { alignSelf: "flex-start" as const, paddingVertical: spacing.xs },
  removeBtnText: { color: c.error, fontSize: typography.sizeSm },
  addBtn: { alignSelf: "flex-start" as const, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  addBtnText: { color: c.text, fontSize: typography.sizeSm },
  saveBtn: { backgroundColor: c.primary, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: "center" as const },
  saveBtnText: { color: c.primaryText, fontSize: typography.sizeMd },
});
