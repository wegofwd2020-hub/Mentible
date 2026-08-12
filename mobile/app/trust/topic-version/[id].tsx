import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { useAuth } from "@/auth/AuthProvider";
import { getTopicVersion, type TopicVersionDetailView, type TopicVersionSummaryView } from "@/api/trustClient";
import { useTrustProject } from "@/hooks/useTrustProject";
import { ApiError } from "@/api/client";
import { Alert } from "@/lib/alert";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import { useTheme, useThemedStyles } from "@/theme";
import { Card, Button } from "@/components/ui";
import { TopicRenderer } from "@/components/LessonRenderer";
import { topicVersionToTopic } from "@/lib/topicVersionToTopic";
import { describeProvenance } from "@/lib/draftProvenance";

type Styles = ReturnType<typeof makeStyles>;

// Read-write viewer for a single per-topic draft version (Slice C2c). Adds
// Approve/Withdraw to the C2b read-only viewer, mirroring
// trust/version/[versionId].tsx's approve/withdraw shape: an owner reveals a
// name field (operator-recorded); a reviewer approves in one tap
// (expert_self); a validated version offers Withdraw behind a confirm.
function TopicVersionViewerInner() {
  const { id, projectId } = useLocalSearchParams<{ id: string; projectId: string }>();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { accessToken } = useAuth();
  const { project, approveTopic, withdrawTopic, generateTopic, listTopicVersions, addTopicFeedback, editTopic } = useTrustProject(String(projectId));
  const [topicVersion, setTopicVersion] = useState<TopicVersionDetailView | null>(null);
  const [versions, setVersions] = useState<TopicVersionSummaryView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [apBusy, setApBusy] = useState(false);
  const [askName, setAskName] = useState(false);
  const [expertName, setExpertName] = useState("");
  const [regen, setRegen] = useState(false);
  const [guidance, setGuidance] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [note, setNote] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ heading: string; body: string; source_ids: string[] }[]>([]);
  const [saving, setSaving] = useState(false);
  const isOwner = project?.my_role === "owner";

  // Build the reader's topic ONCE per version. Building it inline in the JSX
  // handed TopicRenderer a fresh object on every re-render (approve/withdraw
  // reload, theme, busy state) — which re-ran the reader's html memo and reset
  // the diagram container's innerHTML back to the escaped source, wiping the
  // Mermaid SVG the enhance pass had just drawn (the "diagram flashes then
  // reverts to raw code" bug). A stable reference keeps the rendered SVG.
  const builtTopic = useMemo(
    () => (topicVersion ? topicVersionToTopic(topicVersion) : null),
    [topicVersion],
  );

  // Re-fetch just this version (used after approve/withdraw so the header's
  // validated state reflects the append-only toggle).
  const reload = useCallback(async () => {
    if (!accessToken) return;
    const v = await getTopicVersion(String(id), accessToken);
    setTopicVersion(v);
  }, [accessToken, id]);

  useEffect(() => {
    if (!accessToken) return;
    let live = true;
    void (async () => {
      try {
        const v = await getTopicVersion(String(id), accessToken);
        if (live) setTopicVersion(v);
      } catch (e) {
        if (live) setError(e instanceof ApiError ? e.userMessage() : "This draft no longer exists.");
      }
    })();
    return () => { live = false; };
  }, [accessToken, id]);

  // Sibling versions of this same topic, for the inline "Versions" history
  // block — mirrors trust/version/[versionId].tsx's `versions` memo, but
  // fetched separately (not derived from `project`): the project payload only
  // carries the LATEST per-topic status (topic_status), not the full list.
  // Defensive: any failure (no token yet, network) just leaves the list
  // empty — the block itself renders nothing when there's nothing to show.
  const topicId = topicVersion?.topic_id;
  // Refetch the sibling-versions list. Called on load (below) AND after an
  // in-place approve/withdraw, so the current row's validated ✓ in the history
  // block stays in sync with the header badge (both read the same approval).
  const refreshVersions = useCallback(async () => {
    if (!topicId) return;
    try {
      setVersions(await listTopicVersions(topicId));
    } catch {
      setVersions([]);
    }
  }, [topicId, listTopicVersions]);
  useEffect(() => {
    void refreshVersions();
  }, [refreshVersions]);

  // Reviewers self-approve in one tap (expert_self). An owner records on a named
  // expert's behalf (operator) — tapping Approve reveals a name field first.
  const runApprove = (opts?: { expertName: string }) => {
    setApBusy(true);
    void (async () => {
      try {
        const ap = opts ? await approveTopic(String(id), opts) : await approveTopic(String(id));
        setAskName(false);
        setExpertName("");
        // Approval is committed; a failed header refresh must not read as a
        // failed approval, so the reload is best-effort.
        await reload().catch(() => {});
        await refreshVersions().catch(() => {}); // keep the history ✓ in sync
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

  // Owner-only: revise this topic into a new version, optionally with
  // guidance. Mirrors trust/version/[versionId].tsx's openRegen/doRegen —
  // a validated version confirms first (the approval stays on the old
  // version; the new one needs re-approval).
  const openRegen = () => {
    const go = () => setRegen(true);
    if (topicVersion?.is_validated) {
      Alert.alert(
        "Revise a validated draft?",
        `This creates a new version. The approval on v${topicVersion.version_no} stays; the new version needs re-approval.`,
        [{ text: "Cancel", style: "cancel" }, { text: "Revise", onPress: go }],
      );
    } else {
      go();
    }
  };

  const doRegen = async () => {
    if (!topicVersion) return;
    setGenBusy(true);
    try {
      const nv = await generateTopic(topicVersion.topic_id, { guidance: guidance.trim() || undefined });
      setRegen(false);
      setGuidance("");
      router.replace(`/trust/topic-version/${nv.id}?projectId=${projectId}`);
    } catch (e) {
      Alert.alert("Couldn't revise", e instanceof ApiError ? e.userMessage() : "Try again.");
    } finally {
      setGenBusy(false);
    }
  };

  // Owner-only: manually edit this topic's sections into a new version.
  // Mirrors trust/version/[versionId].tsx's startEdit/save — a validated
  // version confirms first (the approval stays on the old version; the new
  // one needs re-approval).
  const startEdit = () => {
    const go = () => {
      setDraft((topicVersion!.content?.sections ?? []).map((s) => ({ ...s, source_ids: [...(s.source_ids ?? [])] })));
      setEditing(true);
    };
    if (topicVersion!.is_validated) {
      Alert.alert(
        "Edit a validated draft?",
        `This creates a new version. The approval on v${topicVersion!.version_no} stays; the new version will need re-approval.`,
        [{ text: "Cancel", style: "cancel" }, { text: "Edit", onPress: go }],
      );
    } else {
      go();
    }
  };

  const updateSection = (i: number, field: "heading" | "body", value: string) => {
    setDraft((prev) => prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)));
  };

  const removeSection = (i: number) => {
    setDraft((prev) => prev.filter((_, idx) => idx !== i));
  };

  const save = async () => {
    if (!topicVersion) return;
    setSaving(true);
    try {
      const v = await editTopic(topicVersion.topic_id, { sections: draft });
      setEditing(false);
      router.replace(`/trust/topic-version/${v.id}?projectId=${projectId}`);
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof ApiError ? e.userMessage() : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const onUnapprove = () => {
    Alert.alert(
      "Withdraw approval",
      `Withdraw the approval on v${topicVersion?.version_no}? This is recorded; the topic returns to awaiting review.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Withdraw",
          style: "destructive",
          onPress: () => {
            setApBusy(true);
            void (async () => {
              try {
                await withdrawTopic(String(id));
                // Withdrawal is committed; the reload is best-effort (see runApprove).
                await reload().catch(() => {});
                await refreshVersions().catch(() => {}); // keep the history ✓ in sync
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

  // Reviewer-only: leaves a revision note for the owner. Mirrors
  // trust/version/[versionId].tsx's onAddFeedback — posts via the hook, then
  // refetches this version (reload, above) so the thread + owner's
  // "Revise from this note" reflect the new note without a full page reload.
  const onAddFeedback = () => {
    const text = note.trim();
    if (!text) return;
    setNoteBusy(true);
    void (async () => {
      try {
        await addTopicFeedback(String(id), { body: text });
        setNote("");
        await reload().catch(() => {});
      } catch (e) {
        Alert.alert("Couldn't send", e instanceof ApiError ? e.userMessage() : "Please try again.");
      } finally {
        setNoteBusy(false);
      }
    })();
  };

  if (error) return <View style={styles.center}><Text style={styles.error}>{error}</Text></View>;
  if (!topicVersion) return <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>;

  // NOT a page-level ScrollView: TopicRenderer's reader div/WebView needs a
  // bounded (flex:1) parent to size against and scrolls its own content — a
  // ScrollView here would give it no definite height and collapse it to a
  // tiny box (the bug app/book/shared/[id].tsx's topic view hit and fixed).
  // Header, actions, and the back link stay fixed above/below the reader body.
  return (
    <View style={styles.screen}>
      <PageContainer style={{ flex: 1 }}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>{topicVersion.title}</Text>
            <Text style={styles.provenance}>{describeProvenance(topicVersion.generation_meta)}</Text>
          </View>
          {topicVersion.is_validated ? (
            <View style={styles.badgeRow}>
              <Text accessibilityLabel={`${topicVersion.title} validated`} style={styles.chip}>Validated ✓</Text>
              {topicVersion.recorded_via === "expert_self" ? (
                <Text style={styles.provChip}>expert-validated</Text>
              ) : topicVersion.recorded_via === "operator" ? (
                <Text style={styles.provChip}>operator-recorded</Text>
              ) : null}
            </View>
          ) : null}
        </View>
        {!editing ? (
          <View style={styles.readerBody}>
            {builtTopic ? <TopicRenderer topic={builtTopic} /> : null}
          </View>
        ) : null}
        {!editing ? (
          <View style={styles.actionsRow}>
            {isOwner ? (
              <Button
                variant="ghost"
                label="Revise"
                accessibilityLabel="Revise draft"
                onPress={openRegen}
              />
            ) : null}
            {isOwner ? (
              <Button
                variant="ghost"
                label="Edit text"
                accessibilityLabel="Edit draft"
                onPress={startEdit}
              />
            ) : null}
            {topicVersion.is_validated ? (
              <Button
                variant="ghost"
                label="Withdraw"
                accessibilityLabel={`Withdraw approval of version ${topicVersion.version_no}`}
                busy={apBusy}
                onPress={onUnapprove}
              />
            ) : (
              <Button
                variant="primary"
                label="Approve"
                accessibilityLabel={`Approve version ${topicVersion.version_no}`}
                busy={apBusy}
                onPress={onApprove}
              />
            )}
          </View>
        ) : null}
        {!editing && regen ? (
          <Card style={styles.editRow}>
            <TextInput
              style={[styles.input, styles.bodyInput]}
              value={guidance}
              onChangeText={setGuidance}
              accessibilityLabel="Revision guidance"
              placeholder="Describe the change — a new version is created"
              placeholderTextColor={theme.textMuted}
              maxLength={500}
              multiline
            />
            <Button
              variant="primary"
              label="Generate new version"
              accessibilityLabel="Generate new version"
              busy={genBusy}
              onPress={doRegen}
            />
          </Card>
        ) : null}
        {!editing && askName ? (
          <Card style={styles.editRow}>
            <Text style={styles.bodyText}>Record this version as validated by an expert. Enter their name — it&apos;s logged as operator-recorded by you.</Text>
            <TextInput
              style={styles.input}
              value={expertName}
              onChangeText={setExpertName}
              accessibilityLabel="Expert name"
              placeholder="Expert's name"
              autoCapitalize="words"
            />
            <Button
              variant="primary"
              label="Record approval"
              accessibilityLabel="Record approval"
              busy={apBusy}
              disabled={!expertName.trim()}
              onPress={submitOwnerApprove}
            />
          </Card>
        ) : null}
        {editing ? (
          <>
            {draft.map((s, i) => (
              <Card key={i} style={styles.editRow}>
                <TextInput
                  style={styles.input}
                  value={s.heading}
                  onChangeText={(t) => updateSection(i, "heading", t)}
                  accessibilityLabel={`Section ${i + 1} heading`}
                  placeholder="Heading"
                  placeholderTextColor={theme.textMuted}
                />
                <TextInput
                  style={[styles.input, styles.bodyInput]}
                  value={s.body}
                  onChangeText={(t) => updateSection(i, "body", t)}
                  accessibilityLabel={`Section ${i + 1} body`}
                  placeholder="Body"
                  placeholderTextColor={theme.textMuted}
                  multiline
                />
                <Button
                  variant="ghost"
                  label="Remove section"
                  accessibilityLabel={`Remove section ${i + 1}`}
                  onPress={() => removeSection(i)}
                />
              </Card>
            ))}
            <View style={styles.actionsRow}>
              <Button
                variant="ghost"
                label="Add section"
                accessibilityLabel="Add section"
                onPress={() => setDraft([...draft, { heading: "", body: "", source_ids: [] }])}
              />
              <Button
                variant="primary"
                label="Save as new version"
                accessibilityLabel="Save as new version"
                busy={saving}
                disabled={draft.length === 0}
                onPress={save}
              />
            </View>
          </>
        ) : null}
        {!editing ? (
          <View style={styles.notesBlock}>
            <Text style={styles.notesTitle}>Revision notes</Text>
            {!isOwner ? (
              <Text style={styles.notesEmpty}>Leaves a note for the owner — they&apos;ll revise the draft.</Text>
            ) : null}
            {(topicVersion.feedback ?? []).length === 0 ? (
              <Text style={styles.notesEmpty}>
                {isOwner ? "No revision notes yet." : "No revision notes yet. Ask for a change below."}
              </Text>
            ) : (
              (topicVersion.feedback ?? []).map((f) => (
                <View key={f.id} style={styles.noteRow}>
                  <Text style={styles.noteMeta}>
                    {f.author_name ?? (f.author_kind === "expert" ? "Expert" : "Owner")}
                    {f.created_at ? ` · ${new Date(f.created_at).toLocaleDateString()}` : ""}
                  </Text>
                  <Text style={styles.noteBody}>{f.body}</Text>
                  {isOwner ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Revise from this note"
                      style={styles.reviseFromNoteBtn}
                      onPress={() => { setGuidance(f.body); openRegen(); }}
                    >
                      <Text style={styles.reviseFromNoteText}>Revise from this note</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))
            )}
            {!isOwner ? (
              <>
                <TextInput
                  style={[styles.input, styles.bodyInput]}
                  value={note}
                  onChangeText={setNote}
                  accessibilityLabel="Revision note"
                  placeholder="Request a revision…"
                  placeholderTextColor={theme.textMuted}
                  maxLength={1000}
                  multiline
                />
                <Button
                  variant="primary"
                  label="Request a revision"
                  accessibilityLabel="Send revision request"
                  busy={noteBusy}
                  disabled={!note.trim()}
                  onPress={onAddFeedback}
                />
              </>
            ) : null}
          </View>
        ) : null}
        {!editing && versions.length > 1 ? (
          <View style={styles.notesBlock}>
            <Text style={styles.notesTitle}>Versions</Text>
            {versions.map((v) => {
              const isCurrent = v.id === id;
              const row = (
                <View style={styles.versionRowInner}>
                  <Text style={styles.bodyText}>
                    v{v.version_no}
                    {v.created_at ? ` · ${new Date(v.created_at).toLocaleDateString()}` : ""}
                    {v.is_validated ? " ✓" : ""}
                  </Text>
                  {isCurrent ? <Text style={styles.notesEmpty}>current</Text> : null}
                </View>
              );
              return isCurrent ? (
                <View key={v.id} style={styles.noteRow}>{row}</View>
              ) : (
                <Pressable
                  key={v.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open version ${v.version_no}`}
                  style={styles.noteRow}
                  onPress={() => router.push({ pathname: "/trust/topic-version/[id]", params: { id: v.id, projectId: String(projectId) } })}
                >
                  {row}
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </PageContainer>
    </View>
  );
}

export default function TopicVersionViewer() {
  return <TopicVersionViewerInner />;
}

const makeStyles = (c: Palette) => ({
  screen: { flex: 1 as const, backgroundColor: c.background },
  center: { flex: 1 as const, alignItems: "center" as const, justifyContent: "center" as const, padding: spacing.xl },
  headerRow: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, flexWrap: "wrap" as const, gap: spacing.sm, padding: spacing.md, paddingBottom: 0 },
  title: { color: c.text, fontSize: typography.sizeXxl, fontFamily: FRAUNCES.bold, letterSpacing: -0.56 },
  provenance: { color: c.textMuted, fontSize: typography.sizeSm, marginTop: 2 },
  badgeRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs },
  chip: { color: c.primaryText, backgroundColor: c.primary, fontSize: typography.sizeSm, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 as const },
  provChip: { color: c.textMuted, fontSize: typography.sizeSm, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 as const },
  // Bounded (flex:1) so TopicRenderer's reader can size against it and scroll
  // its own content — see the render-body comment above.
  readerBody: { flex: 1 as const, marginTop: spacing.sm },
  bodyText: { color: c.text, fontSize: typography.sizeMd, lineHeight: 22 as const },
  error: { color: c.error, fontSize: typography.sizeMd },
  backBtn: { alignSelf: "flex-start" as const, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  backText: { color: c.primary, fontSize: typography.sizeMd },
  actionsRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: spacing.sm, padding: spacing.md, paddingTop: 0 },
  editRow: { gap: spacing.sm, marginHorizontal: spacing.md },
  input: { color: c.text, fontSize: typography.sizeMd, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, padding: spacing.sm },
  bodyInput: { minHeight: 80 as const, textAlignVertical: "top" as const },
  notesBlock: { backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md, gap: spacing.sm, marginHorizontal: spacing.md, marginTop: spacing.sm },
  notesTitle: { color: c.text, fontSize: typography.sizeLg, fontFamily: FRAUNCES.semibold, letterSpacing: -0.36 },
  notesEmpty: { color: c.textMuted, fontSize: typography.sizeSm },
  noteRow: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: spacing.sm, gap: 2 },
  versionRowInner: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, gap: spacing.sm },
  noteMeta: { color: c.textMuted, fontSize: typography.sizeXs, fontWeight: "700" as const },
  noteBody: { color: c.text, fontSize: typography.sizeSm, lineHeight: 20 as const },
  reviseFromNoteBtn: { alignSelf: "flex-start" as const, paddingVertical: spacing.xs },
  reviseFromNoteText: { color: c.primary, fontSize: typography.sizeSm },
});
