import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { PhaseTabBar } from "@/components/PhaseTabBar";
import { Alert } from "@/lib/alert";
import { useTrustProject } from "@/hooks/useTrustProject";
import { ApiError } from "@/api/client";
import { copyText } from "@/lib/clipboard";
import { sectionsToMarkdown, sectionsToPlainText } from "@/lib/draftExport";
import { artifactToBook } from "@/lib/artifactToBook";
import { saveBook } from "@/storage/bookStore";
import { trackedExport } from "@/lib/trackedExport";
import { downloadArtifact } from "@/storage/epubLibrary";
import type { ArtifactDetailView, ProjectInputView } from "@/api/trustClient";
import { deriveProjectPhase, type PhaseKey } from "@/lib/projectPhase";
import { DRAFT_FORMATS, type DraftFormat } from "@/constants/draftFormats";
import { versionTimestamp } from "@/lib/versionTimestamp";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import { useTheme, useThemedStyles } from "@/theme";

type Styles = ReturnType<typeof makeStyles>;
type ThemeShape = ReturnType<typeof useTheme>;

const SOURCE_KINDS: { value: "transcript" | "note" | "link"; label: string }[] = [
  { value: "transcript", label: "Transcript" },
  { value: "note", label: "Note" },
  { value: "link", label: "Link" },
];

// Long-form assets get real Add-to-Library + EPUB/PDF export in Publish
// (they reuse the same book/compiler machinery as authored Books); social
// assets (linkedin/x_thread/reel/podcast) stay Copy-only.
const LONG_FORM = new Set(["book", "essay", "guide"]);

const slug = (t: string) =>
  t.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "asset";

// Collapses the synthetic "create_artifact" sub-state (Drafts, no artifact
// yet) into the "create" tab key. Module-level so both the seed effect
// (which runs before the early-return guards) and render can share it.
function basePhase(k: PhaseKey | "create_artifact"): PhaseKey {
  return k === "create_artifact" ? "create" : k;
}

function sourceKindLabel(kind: string): string {
  return SOURCE_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

function sourcePreview(title: string | null, content: string): string {
  if (title) return title;
  return content.length > 80 ? `${content.slice(0, 80)}…` : content;
}

function sourceDate(createdAt: string | null): string | null {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
}

// Sources (capture phase): the owner's raw-knowledge intake form + the input list.
// Reviewers see the list only — capture is an owner action. Tapping a row opens
// an inline detail (full content, not the truncated preview); the owner can
// edit or delete from there, a reviewer's detail is read-only.
function SourcesPanel({
  styles,
  theme,
  isOwner,
  inputs,
  sourceKind,
  setSourceKind,
  sourceTitle,
  setSourceTitle,
  sourceContent,
  setSourceContent,
  addSourceBusy,
  onAddSource,
  editInput,
  removeInput,
}: {
  styles: Styles;
  theme: ThemeShape;
  isOwner: boolean;
  inputs: ProjectInputView[];
  sourceKind: "transcript" | "note" | "link";
  setSourceKind: (k: "transcript" | "note" | "link") => void;
  sourceTitle: string;
  setSourceTitle: (v: string) => void;
  sourceContent: string;
  setSourceContent: (v: string) => void;
  addSourceBusy: boolean;
  onAddSource: () => void;
  editInput: (inputId: string, body: { title?: string; content?: string; source_ref?: string }) => Promise<ProjectInputView>;
  removeInput: (inputId: string) => Promise<void>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editSourceRef, setEditSourceRef] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const onToggleExpand = (input: ProjectInputView) => {
    if (expandedId === input.id) {
      setExpandedId(null);
      setEditingId(null);
      return;
    }
    setExpandedId(input.id);
    setEditingId(null);
  };

  const onStartEdit = (input: ProjectInputView) => {
    setEditTitle(input.title ?? "");
    setEditContent(input.content);
    setEditSourceRef(input.source_ref ?? "");
    setEditingId(input.id);
  };

  const onSaveEdit = async (inputId: string) => {
    setSaveBusy(true);
    try {
      // Only send `content` when it actually changed — the backend's cited-guard
      // blocks any PATCH that carries `content` on a source cited by a draft, but
      // title/source_ref-only edits are allowed even when cited. Sending an
      // unchanged `content` would needlessly trip that guard.
      const original = inputs.find((i) => i.id === inputId);
      await editInput(inputId, {
        title: editTitle.trim() || undefined,
        content: original && editContent === original.content ? undefined : editContent,
        source_ref: editSourceRef.trim() || undefined,
      });
      setEditingId(null);
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof ApiError ? e.userMessage() : "Please try again.");
    } finally {
      setSaveBusy(false);
    }
  };

  const onDelete = (inputId: string) => {
    Alert.alert("Delete source?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          setDeleteBusy(true);
          void (async () => {
            try {
              await removeInput(inputId);
              setExpandedId(null);
              setEditingId(null);
            } catch (e) {
              Alert.alert("Couldn't delete", e instanceof ApiError ? e.userMessage() : "Please try again.");
            } finally {
              setDeleteBusy(false);
            }
          })();
        },
      },
    ]);
  };

  return (
    <View style={styles.sourcesBlock}>
      <Text style={styles.artifactTitle}>Input</Text>
      <Text style={styles.sourcesHelper}>The expert&apos;s raw knowledge. Paste a transcript, note, or link.</Text>
      {isOwner ? (
        <View style={styles.sourceForm}>
          <View style={styles.kindRow}>
            {SOURCE_KINDS.map(({ value, label }) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityLabel={`Source kind ${label}`}
                style={[styles.kindBtn, sourceKind === value ? styles.kindBtnActive : null]}
                onPress={() => setSourceKind(value)}
              >
                <Text style={sourceKind === value ? styles.kindTextActive : styles.kindText}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.inviteInput}
            placeholder="Title (optional)"
            placeholderTextColor={theme.textMuted}
            value={sourceTitle}
            onChangeText={setSourceTitle}
          />
          <TextInput
            style={styles.sourceContentInput}
            placeholder="Paste a transcript, note, or link…"
            placeholderTextColor={theme.textMuted}
            value={sourceContent}
            onChangeText={setSourceContent}
            multiline
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add source"
            disabled={addSourceBusy || !sourceContent.trim()}
            style={[styles.approveBtn, !sourceContent.trim() ? styles.disabledBtn : null]}
            onPress={onAddSource}
          >
            <Text style={styles.approveText}>{addSourceBusy ? "…" : "Add source"}</Text>
          </Pressable>
        </View>
      ) : null}
      {inputs.length === 0 ? (
        <Text style={styles.emptyText}>
          No sources yet.{isOwner ? " Add a transcript, note, or link above to get started." : ""}
        </Text>
      ) : (
        inputs.map((input) => {
          const isExpanded = expandedId === input.id;
          const isEditing = editingId === input.id;
          return (
            <View key={input.id} style={styles.sourceRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open source ${sourcePreview(input.title, input.content)}`}
                onPress={() => onToggleExpand(input)}
              >
                <Text style={styles.sourceKindLabel}>{sourceKindLabel(input.kind)}</Text>
                <Text style={styles.sourceRowTitle}>{sourcePreview(input.title, input.content)}</Text>
                {sourceDate(input.created_at) ? <Text style={styles.sourceRowDate}>{sourceDate(input.created_at)}</Text> : null}
              </Pressable>
              {isExpanded ? (
                isEditing ? (
                  <View style={styles.sourceDetail}>
                    <TextInput
                      style={styles.inviteInput}
                      accessibilityLabel="Source title"
                      placeholder="Title (optional)"
                      placeholderTextColor={theme.textMuted}
                      value={editTitle}
                      onChangeText={setEditTitle}
                    />
                    <TextInput
                      style={styles.sourceContentInput}
                      accessibilityLabel="Source content"
                      placeholderTextColor={theme.textMuted}
                      value={editContent}
                      onChangeText={setEditContent}
                      multiline
                    />
                    <TextInput
                      style={styles.inviteInput}
                      accessibilityLabel="Source ref"
                      placeholder="Source reference (optional)"
                      placeholderTextColor={theme.textMuted}
                      value={editSourceRef}
                      onChangeText={setEditSourceRef}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Save source"
                      disabled={saveBusy}
                      style={[styles.approveBtn, saveBusy ? styles.disabledBtn : null]}
                      onPress={() => onSaveEdit(input.id)}
                    >
                      <Text style={styles.approveText}>{saveBusy ? "…" : "Save source"}</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.sourceDetail}>
                    <Text style={styles.sourceDetailContent}>{input.content}</Text>
                    {input.source_ref ? <Text style={styles.sourceRowDate}>{input.source_ref}</Text> : null}
                    {isOwner ? (
                      <View style={styles.sourceActionsRow}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Edit source"
                          style={styles.viewBtn}
                          onPress={() => onStartEdit(input)}
                        >
                          <Text style={styles.viewBtnText}>Edit</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Delete source"
                          disabled={deleteBusy}
                          style={[styles.viewBtn, deleteBusy ? styles.disabledBtn : null]}
                          onPress={() => onDelete(input.id)}
                        >
                          <Text style={styles.viewBtnText}>{deleteBusy ? "…" : "Delete"}</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                )
              ) : null}
            </View>
          );
        })
      )}
    </View>
  );
}

// Drafts (create phase): a GENERATE picker (owner) of the 6 format cards, each
// creating its own artifact + first version via generateFormat, followed by
// the DRAFTS list — artifacts → versions, read-only-ish (validated/recorded_via
// state only — Approve lives in FeedbackPanel).
function DraftsPanel({
  styles,
  isOwner,
  artifacts,
  inputs,
  genBusyFormat,
  onGenerateFormat,
  onOpenVersion,
  compareArtifactId,
  compareSel,
  toggleCompareMode,
  toggleCompareSel,
  onCompare,
}: {
  styles: Styles;
  isOwner: boolean;
  artifacts: ArtifactDetailView[];
  inputs: ProjectInputView[];
  genBusyFormat: string | null;
  onGenerateFormat: (fmt: DraftFormat) => void;
  onOpenVersion: (artifactId: string, versionId: string) => void;
  compareArtifactId: string | null;
  compareSel: string[];
  toggleCompareMode: (artifactId: string) => void;
  toggleCompareSel: (versionId: string) => void;
  onCompare: (artifactId: string) => void;
}) {
  return (
    <View style={styles.artifactsWrap}>
      {isOwner ? (
        <View style={styles.genBlock}>
          <Text style={styles.artifactTitle}>Generate</Text>
          <View style={styles.genGrid}>
            {DRAFT_FORMATS.map((f) => {
              const disabled = genBusyFormat !== null || inputs.length === 0;
              return (
                <Pressable
                  key={f.format}
                  accessibilityRole="button"
                  accessibilityLabel={`Generate ${f.label}`}
                  disabled={disabled}
                  style={[styles.genCard, disabled ? styles.disabledBtn : null]}
                  onPress={() => onGenerateFormat(f)}
                >
                  <Text style={styles.genCardLabel}>{f.label}</Text>
                  <Text style={styles.genHint}>{f.hint}</Text>
                  <Text style={styles.genPlus}>{genBusyFormat === f.format ? "…" : "+"}</Text>
                </Pressable>
              );
            })}
          </View>
          {inputs.length === 0 ? <Text style={styles.emptyText}>Add a source first</Text> : null}
        </View>
      ) : null}
      {artifacts.length === 0 ? (
        !isOwner ? <Text style={styles.emptyText}>Waiting for the owner to create a draft.</Text> : null
      ) : (
        artifacts.map(({ artifact, versions }) => {
          const inCompareMode = compareArtifactId === artifact.id;
          return (
            <View key={artifact.id} style={styles.artifact}>
              <Text style={styles.artifactTitle}>{artifact.title ?? artifact.format}</Text>
              {versions.length === 0 ? (
                <Text style={styles.emptyText}>No drafts yet.</Text>
              ) : (
                versions.map((v) => {
                  const ts = versionTimestamp(v.created_at);
                  return (
                    <Pressable
                      key={v.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Open version ${v.version_no}`}
                      style={styles.versionRow}
                      onPress={() => onOpenVersion(artifact.id, v.id)}
                    >
                      <View style={styles.versionRowLeft}>
                        <Text style={styles.versionLabel}>v{v.version_no}</Text>
                        {ts ? <Text style={styles.versionRowTs}>{ts}</Text> : null}
                      </View>
                      {v.is_validated ? (
                        <View style={styles.validatedRow}>
                          <Text accessibilityLabel={`Version ${v.version_no} validated`} style={styles.validated}>Validated ✓</Text>
                          {v.recorded_via === "expert_self" ? (
                            <Text style={styles.chip}>expert-validated</Text>
                          ) : v.recorded_via === "operator" ? (
                            <Text style={styles.chip}>operator-recorded</Text>
                          ) : null}
                        </View>
                      ) : (
                        <Text style={styles.versionLabel}>Awaiting review</Text>
                      )}
                      {inCompareMode ? (
                        <Pressable
                          accessibilityRole="checkbox"
                          accessibilityLabel={`Select version ${v.version_no}`}
                          accessibilityState={{ checked: compareSel.includes(v.id) }}
                          style={[styles.checkbox, compareSel.includes(v.id) ? styles.checkboxOn : null]}
                          onPress={(e) => {
                            e?.stopPropagation?.();
                            toggleCompareSel(v.id);
                          }}
                        />
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`View version ${v.version_no}`}
                        style={styles.viewBtn}
                        onPress={(e) => {
                          e?.stopPropagation?.();
                          onOpenVersion(artifact.id, v.id);
                        }}
                      >
                        <Text style={styles.viewBtnText}>View</Text>
                      </Pressable>
                    </Pressable>
                  );
                })
              )}
              {versions.length >= 2 ? (
                inCompareMode ? (
                  <View style={styles.compareRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Compare selected versions"
                      disabled={compareSel.length !== 2}
                      accessibilityState={{ disabled: compareSel.length !== 2 }}
                      style={[styles.approveBtn, compareSel.length !== 2 ? styles.disabledBtn : null]}
                      onPress={() => onCompare(artifact.id)}
                    >
                      <Text style={styles.approveText}>Compare selected versions</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Cancel"
                      style={styles.compareBtn}
                      onPress={() => toggleCompareMode(artifact.id)}
                    >
                      <Text style={styles.viewBtnText}>Cancel</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Compare versions"
                    style={styles.compareBtn}
                    onPress={() => toggleCompareMode(artifact.id)}
                  >
                    <Text style={styles.viewBtnText}>Compare…</Text>
                  </Pressable>
                )
              ) : null}
            </View>
          );
        })
      )}
    </View>
  );
}

// Feedback (validate phase): a list of versions that opens each one full-screen
// to review — Approve / Unapprove now lives ON the draft view itself (slice 2,
// matching the Lovable IA), not inline here — plus (owner) the Invite-an-expert
// control. Nothing to review until a draft exists, so this stays gated on
// anyVersion.
function FeedbackPanel({
  styles,
  theme,
  isOwner,
  artifacts,
  anyVersion,
  inviteEmail,
  setInviteEmail,
  inviteBusy,
  onInvite,
  onOpenVersion,
  compareArtifactId,
  compareSel,
  toggleCompareMode,
  toggleCompareSel,
  onCompare,
}: {
  styles: Styles;
  theme: ThemeShape;
  isOwner: boolean;
  artifacts: ArtifactDetailView[];
  anyVersion: boolean;
  inviteEmail: string;
  setInviteEmail: (v: string) => void;
  inviteBusy: boolean;
  onInvite: () => void;
  onOpenVersion: (artifactId: string, versionId: string) => void;
  compareArtifactId: string | null;
  compareSel: string[];
  toggleCompareMode: (artifactId: string) => void;
  toggleCompareSel: (versionId: string) => void;
  onCompare: (artifactId: string) => void;
}) {
  if (!anyVersion) {
    return <Text style={styles.emptyText}>Finish Drafts first — generate a draft before it can be reviewed.</Text>;
  }
  return (
    <View style={styles.artifactsWrap}>
      {artifacts.map(({ artifact, versions }) => {
        const inCompareMode = compareArtifactId === artifact.id;
        return (
          <View key={artifact.id} style={styles.artifact}>
            <Text style={styles.artifactTitle}>{artifact.title ?? artifact.format}</Text>
            {versions.map((v) => {
              const ts = versionTimestamp(v.created_at);
              return (
                <Pressable
                  key={v.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open version ${v.version_no}`}
                  style={styles.versionRow}
                  onPress={() => onOpenVersion(artifact.id, v.id)}
                >
                  <View style={styles.versionRowLeft}>
                    <Text style={styles.versionLabel}>v{v.version_no}</Text>
                    {ts ? <Text style={styles.versionRowTs}>{ts}</Text> : null}
                  </View>
                  {v.is_validated ? (
                    <View style={styles.validatedRow}>
                      <Text accessibilityLabel={`Version ${v.version_no} validated`} style={styles.validated}>Validated ✓</Text>
                      {v.recorded_via === "expert_self" ? (
                        <Text style={styles.chip}>expert-validated</Text>
                      ) : v.recorded_via === "operator" ? (
                        <Text style={styles.chip}>operator-recorded</Text>
                      ) : null}
                    </View>
                  ) : (
                    <Text style={styles.versionLabel}>Review →</Text>
                  )}
                  {inCompareMode ? (
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityLabel={`Select version ${v.version_no}`}
                      accessibilityState={{ checked: compareSel.includes(v.id) }}
                      style={[styles.checkbox, compareSel.includes(v.id) ? styles.checkboxOn : null]}
                      onPress={(e) => {
                        e?.stopPropagation?.();
                        toggleCompareSel(v.id);
                      }}
                    />
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`View version ${v.version_no}`}
                    style={styles.viewBtn}
                    onPress={(e) => {
                      e?.stopPropagation?.();
                      onOpenVersion(artifact.id, v.id);
                    }}
                  >
                    <Text style={styles.viewBtnText}>View</Text>
                  </Pressable>
                </Pressable>
              );
            })}
            {versions.length >= 2 ? (
              inCompareMode ? (
                <View style={styles.compareRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Compare selected versions"
                    disabled={compareSel.length !== 2}
                    accessibilityState={{ disabled: compareSel.length !== 2 }}
                    style={[styles.approveBtn, compareSel.length !== 2 ? styles.disabledBtn : null]}
                    onPress={() => onCompare(artifact.id)}
                  >
                    <Text style={styles.approveText}>Compare selected versions</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel"
                    style={styles.compareBtn}
                    onPress={() => toggleCompareMode(artifact.id)}
                  >
                    <Text style={styles.viewBtnText}>Cancel</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Compare versions"
                  style={styles.compareBtn}
                  onPress={() => toggleCompareMode(artifact.id)}
                >
                  <Text style={styles.viewBtnText}>Compare…</Text>
                </Pressable>
              )
            ) : null}
          </View>
        );
      })}
      {isOwner ? (
        <View style={styles.ownerBlock}>
          <Text style={styles.artifactTitle}>Invite an expert</Text>
          <View style={styles.inviteRow}>
            <TextInput
              style={styles.inviteInput}
              placeholder="expert@example.com"
              placeholderTextColor={theme.textMuted}
              value={inviteEmail}
              onChangeText={setInviteEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Invite an expert"
              disabled={inviteBusy}
              style={styles.approveBtn}
              onPress={onInvite}
            >
              <Text style={styles.approveText}>{inviteBusy ? "…" : "Invite"}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

// Publish (share phase): export each APPROVED asset's validated version as plain
// text or Markdown (client-side; content fetched on demand). PDF/Word are an
// honest, disabled "Pro — coming soon" row (billing is dormant — ADR-005/paywall).
function PublishPanel({
  styles,
  artifacts,
  inputs,
  pubBusy,
  onCopyAsset,
  onAddToLibrary,
  onDownloadAsset,
}: {
  styles: Styles;
  artifacts: ArtifactDetailView[];
  inputs: ProjectInputView[];
  pubBusy: string | null;
  onCopyAsset: (versionId: string, fmt: "text" | "markdown", title: string) => void;
  onAddToLibrary: (versionId: string, title: string, format: string) => void;
  onDownloadAsset: (versionId: string, title: string, fmt: "epub" | "pdf") => void;
}) {
  const publishable = artifacts
    .map(({ artifact, versions }) => {
      const validated = versions.filter((v) => v.is_validated);
      const latest = validated[validated.length - 1];
      return latest ? { artifact, version: latest } : null;
    })
    .filter((x): x is { artifact: ArtifactDetailView["artifact"]; version: ArtifactDetailView["versions"][number] } => x !== null);
  if (publishable.length === 0) {
    return (
      <View style={styles.artifactsWrap}>
        <Text style={styles.emptyText}>Nothing to publish yet — approve a version under Feedback, then export it here.</Text>
      </View>
    );
  }
  return (
    <View style={styles.artifactsWrap}>
      <Text style={styles.sourcesHelper}>Export the expert-validated version of each asset.</Text>
      {publishable.map(({ artifact, version }) => {
        const title = artifact.title ?? artifact.format;
        const isLongForm = LONG_FORM.has(artifact.format);
        return (
          <View key={artifact.id} style={styles.artifact}>
            <Text style={styles.artifactTitle}>{title}</Text>
            <View style={styles.validatedRow}>
              <Text style={styles.validated}>Validated ✓</Text>
              <Text style={styles.versionLabel}>v{version.version_no}</Text>
            </View>
            {isLongForm ? (
              <View style={styles.pubActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${title} to Library`}
                  disabled={pubBusy !== null}
                  style={styles.approveBtn}
                  onPress={() => onAddToLibrary(version.id, title, artifact.format)}
                >
                  <Text style={styles.approveText}>{pubBusy === `${version.id}:lib` ? "…" : "Add to Library"}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Download ${title} as EPUB`}
                  disabled={pubBusy !== null}
                  style={styles.approveBtn}
                  onPress={() => onDownloadAsset(version.id, title, "epub")}
                >
                  <Text style={styles.approveText}>{pubBusy === `${version.id}:epub` ? "…" : "Download EPUB"}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Download ${title} as PDF`}
                  disabled={pubBusy !== null}
                  style={styles.approveBtn}
                  onPress={() => onDownloadAsset(version.id, title, "pdf")}
                >
                  <Text style={styles.approveText}>{pubBusy === `${version.id}:pdf` ? "…" : "Download PDF"}</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <View style={styles.pubActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Copy ${title} as text`}
                    disabled={pubBusy !== null}
                    style={styles.approveBtn}
                    onPress={() => onCopyAsset(version.id, "text", title)}
                  >
                    <Text style={styles.approveText}>{pubBusy === `${version.id}:text` ? "…" : "Copy"}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Copy ${title} as Markdown`}
                    disabled={pubBusy !== null}
                    style={styles.approveBtn}
                    onPress={() => onCopyAsset(version.id, "markdown", title)}
                  >
                    <Text style={styles.approveText}>{pubBusy === `${version.id}:markdown` ? "…" : "Copy as Markdown"}</Text>
                  </Pressable>
                </View>
                <Text style={styles.proText}>PDF & Word — Pro (coming soon)</Text>
              </>
            )}
          </View>
        );
      })}
    </View>
  );
}

function TrustProjectDetailInner() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { project, loading, error, refresh, generateFormat, invite, addInput, editInput, removeInput, loadVersionContent, inputs: sourceInputs } = useTrustProject(String(projectId));
  const inputs = sourceInputs ?? [];
  const [inviteEmail, setInviteEmail] = useState("");
  const [pubBusy, setPubBusy] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [genBusyFormat, setGenBusyFormat] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<"transcript" | "note" | "link">("note");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceContent, setSourceContent] = useState("");
  const [addSourceBusy, setAddSourceBusy] = useState(false);
  const [selected, setSelected] = useState<PhaseKey | null>(null);
  const [compareArtifactId, setCompareArtifactId] = useState<string | null>(null);
  const [compareSel, setCompareSel] = useState<string[]>([]);

  const toggleCompareMode = (artifactId: string) => {
    setCompareArtifactId((cur) => (cur === artifactId ? null : artifactId));
    setCompareSel([]);
  };
  const toggleCompareSel = (versionId: string) =>
    setCompareSel((cur) =>
      cur.includes(versionId) ? cur.filter((x) => x !== versionId) : cur.length < 2 ? [...cur, versionId] : cur,
    );

  // Seed the selected tab ONCE, from the phase the project is in when it
  // first loads. Later data changes (e.g. adding a source advances the
  // phase past Sources) must not yank the owner to a different tab — see
  // the "does not yank" journey test. Hooks must run unconditionally, so
  // this sits above the loading/error/!project early returns; project may
  // still be undefined on the first render(s), so it's read directly here
  // rather than via the (not-yet-derived) `phase`.
  useEffect(() => {
    if (project && selected === null) {
      const isOwnerNow = project.my_role === "owner";
      setSelected(basePhase(deriveProjectPhase(project, isOwnerNow).currentKey));
    }
  }, [project, selected]);

  // Approving/unapproving/editing a version happens on a separate screen (the
  // draft viewer, app/trust/version/[versionId].tsx). Refetch on refocus so
  // returning here after that pulls fresh data instead of showing stale
  // is_validated / recorded_via state until a full reload.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  if (loading && !project) return <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>;
  if (error) return <View style={styles.center}><Text style={styles.error}>{error}</Text></View>;
  if (!project) return null;

  const onInvite = async () => {
    const email = inviteEmail.trim();
    if (!email) return;
    setInviteBusy(true);
    try {
      await invite(email);
      setInviteEmail("");
      Alert.alert("Invited", `Invitation sent to ${email}.`);
    } catch (e) {
      Alert.alert("Couldn't invite", e instanceof ApiError ? e.userMessage() : "Please try again.");
    } finally {
      setInviteBusy(false);
    }
  };

  const onGenerateFormat = async (fmt: DraftFormat) => {
    setGenBusyFormat(fmt.format);
    try {
      await generateFormat(fmt);
    } catch (e) {
      Alert.alert("Couldn't generate", e instanceof ApiError ? e.userMessage() : e instanceof Error ? e.message : "Try again.");
    } finally {
      setGenBusyFormat(null);
    }
  };

  const onOpenVersion = (artifactId: string, versionId: string) =>
    router.push({ pathname: "/trust/version/[versionId]", params: { versionId, artifactId, projectId: String(projectId) } });

  const onCompare = (artifactId: string) => {
    if (compareSel.length !== 2) return;
    router.push({
      pathname: "/trust/compare/[versionId]",
      params: { versionId: compareSel[0], b: compareSel[1], artifactId, projectId: String(projectId) },
    });
  };

  const onCopyAsset = (versionId: string, fmt: "text" | "markdown", title: string) => {
    setPubBusy(`${versionId}:${fmt}`);
    void (async () => {
      try {
        const v = await loadVersionContent(versionId);
        const text = fmt === "markdown"
          ? sectionsToMarkdown(v.content?.sections, title)
          : sectionsToPlainText(v.content?.sections, title);
        await copyText(text);
        Alert.alert("Copied", fmt === "markdown" ? "Markdown copied to the clipboard." : "Text copied to the clipboard.");
      } catch (e) {
        Alert.alert("Couldn't copy", e instanceof ApiError ? e.userMessage() : "Please try again.");
      } finally {
        setPubBusy(null);
      }
    })();
  };

  const onAddToLibrary = (versionId: string, title: string, _format: string) => {
    setPubBusy(`${versionId}:lib`);
    void (async () => {
      try {
        const v = await loadVersionContent(versionId);
        const book = artifactToBook(v.content?.sections ?? [], title, inputs);
        await saveBook(book);
        Alert.alert("Added", "Added to your Library.");
      } catch (e) {
        Alert.alert("Couldn't add", e instanceof ApiError ? e.userMessage() : "Please try again.");
      } finally {
        setPubBusy(null);
      }
    })();
  };

  const onDownloadAsset = (versionId: string, title: string, fmt: "epub" | "pdf") => {
    setPubBusy(`${versionId}:${fmt}`);
    void (async () => {
      try {
        const v = await loadVersionContent(versionId);
        const book = artifactToBook(v.content?.sections ?? [], title, inputs);
        const res = await trackedExport(book, fmt, { diagrams: true });
        await downloadArtifact(res.artifact, `${slug(title)}.${fmt}`, fmt === "epub" ? "application/epub+zip" : "application/pdf");
      } catch (e) {
        Alert.alert("Couldn't download", e instanceof ApiError ? e.userMessage() : "Please try again.");
      } finally {
        setPubBusy(null);
      }
    })();
  };

  const onAddSource = async () => {
    const content = sourceContent.trim();
    if (!content) return;
    setAddSourceBusy(true);
    try {
      await addInput({ kind: sourceKind, title: sourceTitle.trim() || undefined, content });
      setSourceTitle("");
      setSourceContent("");
      setSourceKind("note");
    } catch (e) {
      Alert.alert("Couldn't add source", e instanceof ApiError ? e.userMessage() : "Please try again.");
    } finally {
      setAddSourceBusy(false);
    }
  };

  const isOwner = project.my_role === "owner";
  const phase = deriveProjectPhase(project, isOwner);
  // Fallback for the first frame(s) before the seed effect fires; once
  // `selected` is set it wins and no longer tracks phase changes.
  const active = selected ?? basePhase(phase.currentKey);
  const anyVersion = project.artifacts.some((a) => a.versions.length > 0);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
      <PageContainer>
        <Text style={styles.title}>{project.project.title}</Text>
        {project.project.topic ? <Text style={styles.topic}>{project.project.topic}</Text> : null}
        <PhaseTabBar phase={phase} selected={active} onSelect={setSelected} />
        {active === "capture" ? (
          <SourcesPanel
            styles={styles}
            theme={theme}
            isOwner={isOwner}
            inputs={inputs}
            sourceKind={sourceKind}
            setSourceKind={setSourceKind}
            sourceTitle={sourceTitle}
            setSourceTitle={setSourceTitle}
            sourceContent={sourceContent}
            setSourceContent={setSourceContent}
            addSourceBusy={addSourceBusy}
            onAddSource={onAddSource}
            editInput={editInput}
            removeInput={removeInput}
          />
        ) : null}
        {active === "create" ? (
          <DraftsPanel
            styles={styles}
            isOwner={isOwner}
            artifacts={project.artifacts}
            inputs={inputs}
            genBusyFormat={genBusyFormat}
            onGenerateFormat={onGenerateFormat}
            onOpenVersion={onOpenVersion}
            compareArtifactId={compareArtifactId}
            compareSel={compareSel}
            toggleCompareMode={toggleCompareMode}
            toggleCompareSel={toggleCompareSel}
            onCompare={onCompare}
          />
        ) : null}
        {active === "validate" ? (
          <FeedbackPanel
            styles={styles}
            theme={theme}
            isOwner={isOwner}
            artifacts={project.artifacts}
            anyVersion={anyVersion}
            inviteEmail={inviteEmail}
            setInviteEmail={setInviteEmail}
            inviteBusy={inviteBusy}
            onInvite={onInvite}
            onOpenVersion={onOpenVersion}
            compareArtifactId={compareArtifactId}
            compareSel={compareSel}
            toggleCompareMode={toggleCompareMode}
            toggleCompareSel={toggleCompareSel}
            onCompare={onCompare}
          />
        ) : null}
        {active === "share" ? (
          <PublishPanel
            styles={styles}
            artifacts={project.artifacts}
            inputs={inputs}
            pubBusy={pubBusy}
            onCopyAsset={onCopyAsset}
            onAddToLibrary={onAddToLibrary}
            onDownloadAsset={onDownloadAsset}
          />
        ) : null}
      </PageContainer>
    </ScrollView>
  );
}

export default function TrustProjectDetail() {
  // Follows the user's selected theme (ADR-038 O1 reversed).
  return <TrustProjectDetailInner />;
}

const makeStyles = (c: Palette) => ({
  scroll: { flex: 1, backgroundColor: c.background },
  center: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, padding: spacing.xl },
  body: { padding: spacing.md, gap: spacing.md },
  // Fraunces bakes the weight into the family name, so no fontWeight here (a
  // redundant fontWeight would synth faux-bold on web — see applyGlobalFont).
  // letterSpacing = -0.02em × fontSize (export §4 heading tracking).
  title: { color: c.text, fontSize: typography.sizeXxl, fontFamily: FRAUNCES.bold, letterSpacing: -0.56 },
  topic: { color: c.textSecondary, fontSize: typography.sizeMd },
  artifact: { backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md, gap: spacing.sm },
  artifactTitle: { color: c.text, fontSize: typography.sizeLg, fontFamily: FRAUNCES.semibold, letterSpacing: -0.36 },
  versionRow: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, gap: spacing.sm },
  versionRowLeft: { flexShrink: 1 as const },
  versionRowTs: { color: c.textMuted, fontSize: typography.sizeXs },
  versionLabel: { color: c.textSecondary, fontSize: typography.sizeMd },
  validatedRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs },
  viewBtn: {
    borderWidth: 1 as const,
    borderColor: c.border,
    borderRadius: radius.full,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  viewBtnText: { color: c.primary, fontSize: typography.sizeSm, fontWeight: "700" as const },
  validated: { color: c.growth, fontSize: typography.sizeSm, fontWeight: "700" as const },
  chip: {
    color: c.textSecondary,
    fontSize: typography.sizeXs,
    fontWeight: "600" as const,
    backgroundColor: c.surfaceHigh,
    borderRadius: radius.full,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    overflow: "hidden" as const,
  },
  approveBtn: { backgroundColor: c.primary, borderRadius: radius.sm, paddingVertical: spacing.xs, paddingHorizontal: spacing.md },
  approveText: { color: c.primaryText, fontSize: typography.sizeSm, fontWeight: "700" as const },
  pubActions: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: spacing.sm },
  proText: { color: c.textMuted, fontSize: typography.sizeXs, fontStyle: "italic" as const },
  genBlock: {
    backgroundColor: c.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  genGrid: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: spacing.sm },
  genCard: {
    minWidth: 140,
    flexGrow: 1,
    backgroundColor: c.surfaceHigh,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.sm,
    gap: 2,
  },
  genCardLabel: { color: c.text, fontSize: typography.sizeSm, fontFamily: FRAUNCES.semibold },
  genHint: { color: c.textMuted, fontSize: typography.sizeXs },
  genPlus: { color: c.primary, fontSize: typography.sizeMd, fontWeight: "700" as const, alignSelf: "flex-end" as const },
  ownerBlock: {
    backgroundColor: c.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  inviteRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm },
  inviteInput: {
    flex: 1,
    color: c.text,
    fontSize: typography.sizeSm,
    backgroundColor: c.surfaceHigh,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: c.border,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  error: { color: c.error, fontSize: typography.sizeMd, textAlign: "center" as const },
  sourcesBlock: {
    backgroundColor: c.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  sourcesHelper: { color: c.textSecondary, fontSize: typography.sizeSm },
  sourceForm: { gap: spacing.sm },
  kindRow: { flexDirection: "row" as const, gap: spacing.sm },
  kindBtn: {
    backgroundColor: c.surfaceHigh,
    borderRadius: radius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  kindBtnActive: { backgroundColor: c.primary },
  kindText: { color: c.text, fontSize: typography.sizeSm, fontWeight: "600" as const },
  kindTextActive: { color: c.primaryText, fontSize: typography.sizeSm, fontWeight: "600" as const },
  sourceContentInput: {
    color: c.text,
    fontSize: typography.sizeSm,
    backgroundColor: c.surfaceHigh,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: c.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    minHeight: 80,
    textAlignVertical: "top" as const,
  },
  disabledBtn: { opacity: 0.5 },
  emptyText: { color: c.textMuted, fontSize: typography.sizeSm },
  sourceRow: {
    borderTopWidth: 1,
    borderTopColor: c.border,
    paddingTop: spacing.sm,
    gap: 2,
  },
  sourceKindLabel: { color: c.textSecondary, fontSize: typography.sizeXs, fontWeight: "700" as const, textTransform: "uppercase" as const },
  sourceRowTitle: { color: c.text, fontSize: typography.sizeSm },
  sourceRowDate: { color: c.textMuted, fontSize: typography.sizeXs },
  sourceDetail: { gap: spacing.sm, paddingTop: spacing.sm },
  sourceDetailContent: { color: c.text, fontSize: typography.sizeSm },
  sourceActionsRow: { flexDirection: "row" as const, gap: spacing.sm },
  artifactsWrap: { gap: spacing.md },
  compareRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm },
  compareBtn: {
    alignSelf: "flex-start" as const,
    borderWidth: 1 as const,
    borderColor: c.border,
    borderRadius: radius.full,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: radius.sm,
    borderWidth: 2 as const,
    borderColor: c.border,
    backgroundColor: c.surfaceHigh,
  },
  checkboxOn: { backgroundColor: c.primary, borderColor: c.primary },
});
