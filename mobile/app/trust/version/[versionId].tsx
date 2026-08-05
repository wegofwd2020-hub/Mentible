import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { useAuth } from "@/auth/AuthProvider";
import { addFeedback, getVersion, type VersionDetailView } from "@/api/trustClient";
import { useTrustProject } from "@/hooks/useTrustProject";
import { ApiError } from "@/api/client";
import { copyText } from "@/lib/clipboard";
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
  const { project, addVersion, generateVersion, approve, unapprove } = useTrustProject(String(projectId));
  const [version, setVersion] = useState<VersionDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ heading: string; body: string; source_ids: string[] }[]>([]);
  const [saving, setSaving] = useState(false);
  const [regen, setRegen] = useState(false);
  const [guidance, setGuidance] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [apBusy, setApBusy] = useState(false);
  const [askName, setAskName] = useState(false);
  const [expertName, setExpertName] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const isOwner = project?.my_role === "owner";

  // Re-fetch just this version (used after approve/unapprove so the header's
  // validated state reflects the append-only toggle without a full reload).
  const reloadVersion = useCallback(async () => {
    if (!accessToken) return;
    const v = await getVersion(String(versionId), accessToken);
    setVersion(v);
  }, [accessToken, versionId]);

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
    const go = () => {
      setDraft((version!.content?.sections ?? []).map((s) => ({ ...s, source_ids: [...(s.source_ids ?? [])] })));
      setEditing(true);
    };
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

  const openRegen = () => {
    const go = () => setRegen(true);
    if (version!.is_validated) {
      Alert.alert(
        "Regenerate a validated draft?",
        `This creates a new version. The approval on v${version!.version_no} stays; the new version will need re-approval.`,
        [{ text: "Cancel", style: "cancel" }, { text: "Regenerate", onPress: go }],
      );
    } else { go(); }
  };

  const doRegen = async () => {
    setGenBusy(true);
    try {
      const v = await generateVersion(String(artifactId), { guidance: guidance.trim() || undefined });
      router.push({ pathname: "/trust/version/[versionId]", params: { versionId: v.id, artifactId: String(artifactId), projectId: String(projectId) } });
      setRegen(false); setGuidance("");
    } catch (e) {
      Alert.alert("Couldn't regenerate", e instanceof ApiError ? e.userMessage() : "Try again.");
    } finally { setGenBusy(false); }
  };

  const onCopy = async () => {
    const text = (version!.content?.sections ?? [])
      .map((s) => [s.heading, s.body].map((t) => (t ?? "").trim()).filter(Boolean).join("\n\n"))
      .filter(Boolean)
      .join("\n\n");
    try {
      await copyText(text);
      Alert.alert("Copied", "Draft content copied to the clipboard.");
    } catch {
      Alert.alert("Couldn't copy", "Please try again.");
    }
  };

  // Reviewers self-approve in one tap (expert_self). An owner records on a named
  // expert's behalf (operator) — tapping Approve reveals a name field first.
  const runApprove = (opts?: { expertName: string }) => {
    setApBusy(true);
    void (async () => {
      try {
        const ap = opts ? await approve(String(versionId), opts) : await approve(String(versionId));
        setAskName(false);
        setExpertName("");
        // Approval is committed; a failed header refresh must not read as a
        // failed approval, so the reload is best-effort.
        await reloadVersion().catch(() => {});
        Alert.alert(
          "Approved",
          ap.recorded_via === "expert_self" ? "Recorded as expert-validated." : `Recorded as validated by ${ap.expert_name}.`,
        );
      } catch (e) {
        Alert.alert("Couldn't approve", e instanceof ApiError ? e.userMessage() : "Please try again.");
      } finally {
        setApBusy(false);
      }
    })();
  };

  const onApprove = () => {
    if (isOwner) { setAskName(true); return; }
    runApprove();
  };

  const submitOwnerApprove = () => {
    const name = expertName.trim();
    if (name) runApprove({ expertName: name });
  };

  const onUnapprove = () => {
    Alert.alert(
      "Withdraw approval",
      `Withdraw the approval on v${version!.version_no}? This is recorded; the version returns to awaiting review.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Withdraw",
          style: "destructive",
          onPress: () => {
            setApBusy(true);
            void (async () => {
              try {
                await unapprove(String(versionId));
                // Withdrawal is committed; the reload is best-effort (see runApprove).
                await reloadVersion().catch(() => {});
              } catch (e) {
                Alert.alert("Couldn't withdraw", e instanceof ApiError ? e.userMessage() : "Please try again.");
              } finally {
                setApBusy(false);
              }
            })();
          },
        },
      ],
    );
  };

  const onAddFeedback = () => {
    const text = noteBody.trim();
    if (!text || !accessToken) return;
    setNoteBusy(true);
    void (async () => {
      try {
        await addFeedback(String(versionId), { body: text }, accessToken);
        setNoteBody("");
        await reloadVersion().catch(() => {});
      } catch (e) {
        Alert.alert("Couldn't send", e instanceof ApiError ? e.userMessage() : "Please try again.");
      } finally {
        setNoteBusy(false);
      }
    })();
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
        </View>
        {!editing ? (
          <View style={styles.actionsRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Copy draft" style={styles.editBtn} onPress={onCopy}>
              <Text style={styles.editBtnText}>Copy</Text>
            </Pressable>
            {isOwner ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Edit draft" style={styles.editBtn} onPress={startEdit}>
                <Text style={styles.editBtnText}>Edit</Text>
              </Pressable>
            ) : null}
            {isOwner ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Regenerate draft" style={styles.editBtn} onPress={openRegen}>
                <Text style={styles.editBtnText}>Regenerate</Text>
              </Pressable>
            ) : null}
            {version.is_validated ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Withdraw approval of version ${version.version_no}`} disabled={apBusy} style={styles.unapproveBtn} onPress={onUnapprove}>
                <Text style={styles.unapproveText}>{apBusy ? "…" : "Unapprove"}</Text>
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel={`Approve version ${version.version_no}`} disabled={apBusy} style={styles.approveBtn} onPress={onApprove}>
                <Text style={styles.approveText}>{apBusy ? "…" : "Approve"}</Text>
              </Pressable>
            )}
          </View>
        ) : null}
        {!editing && askName ? (
          <View style={styles.editRow}>
            <Text style={styles.bodyText}>Record this version as validated by an expert. Enter their name — it&apos;s logged as operator-recorded by you.</Text>
            <TextInput
              style={styles.input}
              value={expertName}
              onChangeText={setExpertName}
              accessibilityLabel="Expert name"
              placeholder="Expert's name"
              autoCapitalize="words"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Record approval"
              style={[styles.saveBtn, !expertName.trim() ? styles.disabledBtn : null]}
              disabled={apBusy || !expertName.trim()}
              onPress={submitOwnerApprove}
            >
              <Text style={styles.saveBtnText}>{apBusy ? "Recording…" : "Record approval"}</Text>
            </Pressable>
          </View>
        ) : null}
        {!editing && regen ? (
          <View style={styles.editRow}>
            <TextInput
              style={[styles.input, styles.bodyInput]}
              value={guidance}
              onChangeText={setGuidance}
              accessibilityLabel="Regeneration guidance"
              placeholder="Optional: focus on…"
              maxLength={500}
              multiline
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Generate new version"
              style={styles.saveBtn}
              disabled={genBusy}
              onPress={doRegen}
            >
              <Text style={styles.saveBtnText}>{genBusy ? "Generating…" : "Generate new version"}</Text>
            </Pressable>
          </View>
        ) : null}
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
              disabled={saving || draft.length === 0}
              onPress={save}
            >
              <Text style={styles.saveBtnText}>{saving ? "Saving…" : "Save as new version"}</Text>
            </Pressable>
          </>
        ) : (
          (version.content?.sections ?? []).map((s, i) => (
            <View key={i} style={styles.section}>
              <Text style={styles.heading}>{s.heading}</Text>
              <Text style={styles.bodyText}>{s.body}</Text>
              {(s.source_ids ?? []).length > 0 ? (
                <View style={styles.citeRow}>
                  {(s.source_ids ?? []).map((id) => (
                    <Text key={id} style={styles.cite}>{labelFor.get(id) ?? "cited"}</Text>
                  ))}
                </View>
              ) : null}
            </View>
          ))
        )}
        {!editing ? (
          <View style={styles.notesBlock}>
            <Text style={styles.notesTitle}>Revision notes</Text>
            {(version.feedback ?? []).length === 0 ? (
              <Text style={styles.notesEmpty}>No revision notes yet. Ask for a change below.</Text>
            ) : (
              (version.feedback ?? []).map((f) => (
                <View key={f.id} style={styles.noteRow}>
                  <Text style={styles.noteMeta}>
                    {f.author_name ?? (f.author_kind === "expert" ? "Expert" : "Owner")}
                    {f.created_at ? ` · ${new Date(f.created_at).toLocaleDateString()}` : ""}
                  </Text>
                  <Text style={styles.noteBody}>{f.body}</Text>
                </View>
              ))
            )}
            <TextInput
              style={[styles.input, styles.bodyInput]}
              value={noteBody}
              onChangeText={setNoteBody}
              accessibilityLabel="Revision note"
              placeholder="Request a revision…"
              maxLength={1000}
              multiline
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send revision request"
              style={[styles.saveBtn, !noteBody.trim() ? styles.disabledBtn : null]}
              disabled={noteBusy || !noteBody.trim()}
              onPress={onAddFeedback}
            >
              <Text style={styles.saveBtnText}>{noteBusy ? "Sending…" : "Request a revision"}</Text>
            </Pressable>
          </View>
        ) : null}
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
  actionsRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: spacing.sm },
  editBtn: { borderWidth: 1, borderColor: c.primary, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  editBtnText: { color: c.primary, fontSize: typography.sizeSm },
  approveBtn: { backgroundColor: c.primary, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  approveText: { color: c.primaryText, fontSize: typography.sizeSm, fontWeight: "700" as const },
  unapproveBtn: { borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  unapproveText: { color: c.textSecondary, fontSize: typography.sizeSm },
  editRow: { backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md, gap: spacing.sm },
  input: { color: c.text, fontSize: typography.sizeMd, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, padding: spacing.sm },
  bodyInput: { minHeight: 80 as const, textAlignVertical: "top" as const },
  removeBtn: { alignSelf: "flex-start" as const, paddingVertical: spacing.xs },
  removeBtnText: { color: c.error, fontSize: typography.sizeSm },
  addBtn: { alignSelf: "flex-start" as const, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  addBtnText: { color: c.text, fontSize: typography.sizeSm },
  saveBtn: { backgroundColor: c.primary, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: "center" as const },
  saveBtnText: { color: c.primaryText, fontSize: typography.sizeMd },
  disabledBtn: { opacity: 0.5 },
  notesBlock: { backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md, gap: spacing.sm },
  notesTitle: { color: c.text, fontSize: typography.sizeLg, fontFamily: FRAUNCES.semibold, letterSpacing: -0.36 },
  notesEmpty: { color: c.textMuted, fontSize: typography.sizeSm },
  noteRow: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: spacing.sm, gap: 2 },
  noteMeta: { color: c.textMuted, fontSize: typography.sizeXs, fontWeight: "700" as const },
  noteBody: { color: c.text, fontSize: typography.sizeSm, lineHeight: 20 as const },
});
