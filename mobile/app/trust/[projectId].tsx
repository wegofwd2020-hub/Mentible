import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { PhaseTabBar } from "@/components/PhaseTabBar";
import { PhaseNav } from "@/components/PhaseNav";
import { TopicTreeEditor } from "@/components/TopicTreeEditor";
import { Alert } from "@/lib/alert";
import { useTrustProject } from "@/hooks/useTrustProject";
import { ApiError } from "@/api/client";
import { copyText } from "@/lib/clipboard";
import { sectionsToMarkdown, sectionsToPlainText } from "@/lib/draftExport";
import { artifactToBook } from "@/lib/artifactToBook";
import { topicsToBook } from "@/lib/topicsToBook";
import { saveBook } from "@/storage/bookStore";
import { trackedExport } from "@/lib/trackedExport";
import { downloadArtifact } from "@/storage/epubLibrary";
import { randomUUID } from "@/lib/uuid";
import { getTopicVersion } from "@/api/trustClient";
import type { ArtifactDetailView, DraftSection, ProjectInputView, StructuredTocUnit, StructuredTocView, TopicStatusView } from "@/api/trustClient";
import type { Book, StructuredTOC, Subtopic } from "@/types/book";
import { deriveProjectPhase, type PhaseKey } from "@/lib/projectPhase";
import { nextStep } from "@/lib/nextStep";
import { DRAFT_FORMATS, type DraftFormat } from "@/constants/draftFormats";
import { versionTimestamp } from "@/lib/versionTimestamp";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import { useTheme, useThemedStyles } from "@/theme";
import { Button, Card, Chip, Label } from "@/components/ui";
import { GenerateProgressBar } from "@/components/GenerateProgressBar";
import { useElapsedMs } from "@/hooks/useElapsedMs";

type Styles = ReturnType<typeof makeStyles>;
type ThemeShape = ReturnType<typeof useTheme>;

type GenProgress = { startedAt: number; phase: "queued" | "running" };

// A tiny wrapper so the per-topic .map() can render a live elapsed-time bar:
// useElapsedMs is a hook and cannot be called directly inside a loop body.
function TopicRowProgress({ startedAt, phase }: { startedAt: number; phase: "queued" | "running" }) {
  const elapsed = useElapsedMs(startedAt);
  return <GenerateProgressBar phase={phase} elapsedMs={elapsed} />;
}

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

// True when the outline has at least one topic to lose — gates the
// confirm-replace prompt before a Suggest result overwrites it.
function tocHasContent(toc: StructuredTOC): boolean {
  return toc.subjects.some((s) => s.units.length > 0);
}

// The wire TOC (`StructuredTocView`, trustClient.ts) and the editor TOC
// (`StructuredTOC`, types/book.ts) are structurally close but NOT identical —
// `StructuredTocUnit.id` is required, `TopicNode.id` is optional;
// `StructuredTocUnit.subtopics` is `unknown[]`, `TopicNode.subtopics` is
// `Subtopic[]` (a `string | {label,detail}` union); `TopicNode` also carries
// an editor-only `enhancementInstructions` the wire type has no field for. A
// blind `as unknown as` cast across that gap defeats tsc at exactly the spot
// it would catch a real drift, so map field-by-field instead.
function toSubtopics(raw: unknown[] | null | undefined): Subtopic[] {
  return (raw ?? []).map((s) => {
    if (typeof s === "string") return s;
    if (s && typeof s === "object" && typeof (s as { label?: unknown }).label === "string") {
      const { label, detail } = s as { label: string; detail?: unknown };
      return typeof detail === "string" ? { label, detail } : { label };
    }
    return String(s);
  });
}

function tocViewToStructured(view: StructuredTocView): StructuredTOC {
  return {
    subjects: view.subjects.map((s) => ({
      subject_label: s.subject_label,
      units: (s.units ?? []).map((u) => ({
        id: u.id,
        title: u.title,
        subtopics: toSubtopics(u.subtopics ?? []),
        prerequisites: u.prerequisites,
        source_ids: u.source_ids,
      })),
    })),
  };
}

function structuredToTocView(toc: StructuredTOC): StructuredTocView {
  return {
    subjects: toc.subjects.map((s) => ({
      subject_label: s.subject_label,
      units: s.units.map(
        (u): StructuredTocUnit => ({
          id: u.id ?? randomUUID(),
          title: u.title,
          subtopics: u.subtopics,
          prerequisites: u.prerequisites,
          source_ids: u.source_ids,
        }),
      ),
    })),
  };
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
  sourceUrl,
  setSourceUrl,
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
  sourceUrl: string;
  setSourceUrl: (v: string) => void;
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

  const canAdd = sourceKind === "link" ? sourceUrl.trim().length > 0 : sourceContent.trim().length > 0;

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
            placeholder={sourceKind === "link" ? "Label (optional)" : "Title (optional)"}
            placeholderTextColor={theme.textMuted}
            value={sourceTitle}
            onChangeText={setSourceTitle}
          />
          {sourceKind === "link" ? (
            <TextInput
              style={styles.inviteInput}
              accessibilityLabel="Source URL"
              placeholder="https://…"
              placeholderTextColor={theme.textMuted}
              value={sourceUrl}
              onChangeText={setSourceUrl}
              autoCapitalize="none"
              keyboardType="url"
              autoCorrect={false}
            />
          ) : (
            <TextInput
              style={styles.sourceContentInput}
              placeholder="Paste a transcript, note, or link…"
              placeholderTextColor={theme.textMuted}
              value={sourceContent}
              onChangeText={setSourceContent}
              multiline
            />
          )}
          <Button
            variant="ghost"
            label="Add source"
            onPress={onAddSource}
            busy={addSourceBusy}
            disabled={!canAdd}
            accessibilityLabel="Add source"
          />
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
            <Card key={input.id} style={styles.sourceRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open source ${sourcePreview(input.title, input.content)}`}
                onPress={() => onToggleExpand(input)}
              >
                <Label tone="secondary">{sourceKindLabel(input.kind)}</Label>
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
                    <Button
                      variant="primary"
                      label="Save source"
                      onPress={() => onSaveEdit(input.id)}
                      busy={saveBusy}
                      accessibilityLabel="Save source"
                    />
                  </View>
                ) : (
                  <View style={styles.sourceDetail}>
                    <Text style={styles.sourceDetailContent}>{input.content}</Text>
                    {input.source_ref ? <Text style={styles.sourceRowDate}>{input.source_ref}</Text> : null}
                    {isOwner ? (
                      <View style={styles.sourceActionsRow}>
                        <Button
                          variant="ghost"
                          label="Edit"
                          onPress={() => onStartEdit(input)}
                          accessibilityLabel="Edit source"
                        />
                        <Button
                          variant="ghost"
                          label="Delete"
                          onPress={() => onDelete(input.id)}
                          busy={deleteBusy}
                          accessibilityLabel="Delete source"
                        />
                      </View>
                    ) : null}
                  </View>
                )
              ) : null}
            </Card>
          );
        })
      )}
    </View>
  );
}

// Structure (structure phase): an editable topic tree (TOC) the owner shapes
// before drafting — either by hand or by suggesting one from the sources
// captured so far. Reviewers get the same tree rendered read-only (no
// Suggest/Next, and edits never reach onChangeToc, so nothing can persist).
function StructurePanel({
  styles,
  isOwner,
  toc,
  onChangeToc,
  onSuggest,
  suggestBusy,
  sourceLabel,
  inputsEmpty,
}: {
  styles: Styles;
  isOwner: boolean;
  toc: StructuredTOC;
  onChangeToc: (next: StructuredTOC) => void;
  onSuggest: () => void;
  suggestBusy: boolean;
  sourceLabel: (id: string) => string;
  inputsEmpty: boolean;
}) {
  return (
    <View style={styles.structureBlock}>
      <Text style={styles.artifactTitle}>Structure</Text>
      <Text style={styles.sourcesHelper}>
        Shape the outline before drafting — group topics into subjects, or suggest one from your sources.
      </Text>
      {isOwner ? (
        <>
          <View style={styles.structureActions}>
            <Button
              variant="primary"
              label="Suggest from sources"
              onPress={onSuggest}
              busy={suggestBusy}
              disabled={inputsEmpty}
              accessibilityLabel="Suggest outline from sources"
            />
          </View>
          {inputsEmpty ? <Text style={styles.emptyText}>Add a source first</Text> : null}
          <TopicTreeEditor toc={toc} onChange={onChangeToc} sourceLabel={sourceLabel} />
        </>
      ) : (
        // No onChange path to saveToc for a reviewer — edits made in this
        // tree simply vanish on the next render (toc is owner-controlled).
        <TopicTreeEditor toc={toc} onChange={() => {}} sourceLabel={sourceLabel} />
      )}
    </View>
  );
}

// Status-chip label for a per-topic row — mirrors TopicStatusView.status
// ("not_generated" | "drafted" | "validated"); "validated" reads active
// (matches the Validated ✓ treatment used for whole-book versions above).
function topicStatusLabel(status: TopicStatusView["status"] | undefined): string {
  if (status === "validated") return "Validated";
  if (status === "drafted") return "Drafted";
  return "Not generated";
}

// Drafts (create phase): a GENERATE picker (owner) of the 6 format cards, each
// creating its own artifact + first version via generateFormat, followed by
// the DRAFTS list — artifacts → versions, read-only-ish (validated/recorded_via
// state only — Approve lives in FeedbackPanel). A `Whole book | Per topic`
// toggle (only rendered once the project has a TOC — Slice C2b) switches
// between this whole-book view and a per-topic list grouped by subject, each
// row offering Generate/Regenerate (owner) + Open (once a draft exists).
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
  toc,
  topicStatus,
  topicGen,
  onGenerateTopic,
  onOpenTopic,
  initialMode,
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
  toc: StructuredTocView | undefined;
  topicStatus: TopicStatusView[];
  topicGen: ReadonlyMap<string, GenProgress>;
  onGenerateTopic: (topicId: string) => void;
  onOpenTopic: (versionId: string) => void;
  initialMode?: "whole" | "topic";
}) {
  const [mode, setMode] = useState<"whole" | "topic">(initialMode ?? "whole");
  const hasToc = (toc?.subjects?.length ?? 0) > 0;
  const statusByTopic = new Map(topicStatus.map((s) => [s.topic_id, s]));

  return (
    <View style={styles.artifactsWrap}>
      {hasToc ? (
        <View style={styles.kindRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Whole book"
            accessibilityState={{ selected: mode === "whole" }}
            style={[styles.kindBtn, mode === "whole" ? styles.kindBtnActive : null]}
            onPress={() => setMode("whole")}
          >
            <Text style={mode === "whole" ? styles.kindTextActive : styles.kindText}>Whole book</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Per topic"
            accessibilityState={{ selected: mode === "topic" }}
            style={[styles.kindBtn, mode === "topic" ? styles.kindBtnActive : null]}
            onPress={() => setMode("topic")}
          >
            <Text style={mode === "topic" ? styles.kindTextActive : styles.kindText}>Per topic</Text>
          </Pressable>
        </View>
      ) : null}
      {hasToc && mode === "topic" ? (
        <View style={styles.artifactsWrap}>
          {toc?.subjects.map((subject) => (
            <View key={subject.subject_label} style={styles.artifact}>
              <Label tone="secondary">{subject.subject_label}</Label>
              {subject.units.map((unit) => {
                const status = statusByTopic.get(unit.id);
                const prog = topicGen.get(unit.id);
                const isBusy = prog !== undefined;
                const label = status && status.status !== "not_generated" ? "Regenerate" : "Generate";
                return (
                  <View key={unit.id} style={styles.topicRow}>
                    <View style={styles.topicRowMain}>
                      <View style={styles.topicRowLeft}>
                        <Text style={styles.topicRowTitle}>{unit.title}</Text>
                        <Chip label={topicStatusLabel(status?.status)} active={status?.status === "validated"} />
                      </View>
                      <View style={styles.topicRowActions}>
                        {isOwner ? (
                          <Button
                            variant="primary"
                            label={label}
                            onPress={() => onGenerateTopic(unit.id)}
                            busy={isBusy}
                            disabled={isBusy}
                            accessibilityLabel={`${label} ${unit.title}`}
                          />
                        ) : null}
                        {status?.latest_version_id ? (
                          <Button
                            variant="ghost"
                            label="Open"
                            onPress={() => onOpenTopic(status.latest_version_id as string)}
                            accessibilityLabel={`Open ${unit.title}`}
                          />
                        ) : null}
                      </View>
                    </View>
                    {prog ? <TopicRowProgress startedAt={prog.startedAt} phase={prog.phase} /> : null}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      ) : null}
      {mode === "whole" ? (
        <>
          {isOwner ? (
            <View style={styles.genBlock}>
              <Text style={styles.artifactTitle}>Start a new draft</Text>
              <Text style={styles.genHint}>
                Creates a fresh draft (v1). To make a new version of an existing draft, open it and Regenerate.
              </Text>
              <View style={styles.genGrid}>
                {DRAFT_FORMATS.map((f) => {
                  const disabled = genBusyFormat !== null || inputs.length === 0;
                  return (
                    <Pressable
                      key={f.format}
                      accessibilityRole="button"
                      accessibilityLabel={`Start a new ${f.label} draft`}
                      disabled={disabled}
                      style={styles.genCardPressable}
                      onPress={() => onGenerateFormat(f)}
                    >
                      <Card style={[styles.genCard, disabled ? styles.disabledBtn : null]}>
                        <Text style={styles.genCardLabel}>{f.label}</Text>
                        <Text style={styles.genHint}>{f.hint}</Text>
                        <Text style={styles.genPlus}>{genBusyFormat === f.format ? "…" : "+"}</Text>
                      </Card>
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
            <>
              <Text style={styles.artifactTitle}>Your drafts</Text>
              {artifacts.map(({ artifact, versions }) => {
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
                            {/* Raw Pressable (not <Button>) — nested inside this row's own
                                onPress, so it needs the real event to stopPropagation and
                                avoid double-firing onOpenVersion on web; Button's onPress
                                is () => void and can't receive it. */}
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
                          <Button
                            variant="primary"
                            label="Compare selected versions"
                            onPress={() => onCompare(artifact.id)}
                            disabled={compareSel.length !== 2}
                            accessibilityLabel="Compare selected versions"
                          />
                          <Button
                            variant="ghost"
                            label="Cancel"
                            onPress={() => toggleCompareMode(artifact.id)}
                            accessibilityLabel="Cancel"
                          />
                        </View>
                      ) : (
                        <Button
                          variant="ghost"
                          label="Compare…"
                          onPress={() => toggleCompareMode(artifact.id)}
                          accessibilityLabel="Compare versions"
                          style={styles.compareBtnAlign}
                        />
                      )
                    ) : null}
                  </View>
                );
              })}
            </>
          )}
        </>
      ) : null}
    </View>
  );
}

// Feedback (validate phase): a list of versions that opens each one full-screen
// to review — Approve / Unapprove now lives ON the draft view itself (slice 2,
// matching the Lovable IA), not inline here — plus (owner) the Invite-an-expert
// control. Nothing to review until a draft exists, so the whole-book branch
// stays gated on anyVersion. A `Whole book | Per topic` toggle (only rendered
// once the project has a TOC — Slice C2c, mirroring the C2b Drafts toggle)
// switches to a rollup header (`{validated}/{total} topics validated` +
// book_validated indicator) plus the TOC grouped by subject, each topic
// showing its status badge and an Open (no inline Approve — that lives on the
// topic viewer, app/trust/topic-version/[versionId].tsx).
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
  toc,
  topicStatus,
  bookValidated,
  onOpenTopic,
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
  toc: StructuredTocView | undefined;
  topicStatus: TopicStatusView[];
  bookValidated: boolean;
  onOpenTopic: (versionId: string) => void;
}) {
  const [mode, setMode] = useState<"whole" | "topic">("whole");
  const hasToc = (toc?.subjects?.length ?? 0) > 0;
  const statusByTopic = new Map(topicStatus.map((s) => [s.topic_id, s]));
  const totalTopics = toc?.subjects.reduce((sum, s) => sum + s.units.length, 0) ?? 0;
  const validatedTopics = topicStatus.filter((s) => s.status === "validated").length;

  return (
    <View style={styles.artifactsWrap}>
      {hasToc ? (
        <View style={styles.kindRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Whole book"
            accessibilityState={{ selected: mode === "whole" }}
            style={[styles.kindBtn, mode === "whole" ? styles.kindBtnActive : null]}
            onPress={() => setMode("whole")}
          >
            <Text style={mode === "whole" ? styles.kindTextActive : styles.kindText}>Whole book</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Per topic"
            accessibilityState={{ selected: mode === "topic" }}
            style={[styles.kindBtn, mode === "topic" ? styles.kindBtnActive : null]}
            onPress={() => setMode("topic")}
          >
            <Text style={mode === "topic" ? styles.kindTextActive : styles.kindText}>Per topic</Text>
          </Pressable>
        </View>
      ) : null}
      {hasToc && mode === "topic" ? (
        <View style={styles.artifactsWrap}>
          <View style={styles.rollupHeader}>
            <Text style={styles.rollupText}>{validatedTopics}/{totalTopics} topics validated</Text>
            <Chip label={bookValidated ? "Book validated ✓" : "Not yet book-validated"} active={bookValidated} />
          </View>
          {toc?.subjects.map((subject) => (
            <View key={subject.subject_label} style={styles.artifact}>
              <Label tone="secondary">{subject.subject_label}</Label>
              {subject.units.map((unit) => {
                const status = statusByTopic.get(unit.id);
                return (
                  <View key={unit.id} style={styles.topicRow}>
                    <View style={styles.topicRowMain}>
                      <View style={styles.topicRowLeft}>
                        <Text style={styles.topicRowTitle}>{unit.title}</Text>
                        <Chip label={topicStatusLabel(status?.status)} active={status?.status === "validated"} />
                      </View>
                      <View style={styles.topicRowActions}>
                        {status?.latest_version_id ? (
                          <Button
                            variant="ghost"
                            label="Open"
                            onPress={() => onOpenTopic(status.latest_version_id as string)}
                            accessibilityLabel={`Open ${unit.title}`}
                          />
                        ) : null}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      ) : null}
      {mode === "whole" && !anyVersion ? (
        <Text style={styles.emptyText}>Finish Drafts first — generate a draft before it can be reviewed.</Text>
      ) : null}
      {mode === "whole" && anyVersion ? (
        <>
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
                  {/* Raw Pressable (not <Button>) — nested inside this row's own
                      onPress, so it needs the real event to stopPropagation and
                      avoid double-firing onOpenVersion on web; Button's onPress
                      is () => void and can't receive it. */}
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
                  <Button
                    variant="primary"
                    label="Compare selected versions"
                    onPress={() => onCompare(artifact.id)}
                    disabled={compareSel.length !== 2}
                    accessibilityLabel="Compare selected versions"
                  />
                  <Button
                    variant="ghost"
                    label="Cancel"
                    onPress={() => toggleCompareMode(artifact.id)}
                    accessibilityLabel="Cancel"
                  />
                </View>
              ) : (
                <Button
                  variant="ghost"
                  label="Compare…"
                  onPress={() => toggleCompareMode(artifact.id)}
                  accessibilityLabel="Compare versions"
                  style={styles.compareBtnAlign}
                />
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
            <Button
              variant="primary"
              label="Invite"
              onPress={onInvite}
              busy={inviteBusy}
              accessibilityLabel="Invite an expert"
            />
          </View>
        </View>
      ) : null}
        </>
      ) : null}
    </View>
  );
}

// Publish (share phase): export each APPROVED asset's validated version as plain
// text or Markdown (client-side; content fetched on demand). PDF/Word are an
// honest, disabled "Pro — coming soon" row (billing is dormant — ADR-005/paywall).
// A `Whole book | Per topic` toggle (only rendered once the project has a TOC —
// Slice D, mirroring the C2b/C2c toggles) switches to a rollup header
// (`{validated}/{total} topics validated` + book_validated indicator) plus a
// Publish-book block: Add to Library / Download EPUB / Download PDF, gated on
// `bookValidated` and owner-only (the assembly itself is an owner action).
function PublishPanel({
  styles,
  isOwner,
  artifacts,
  inputs,
  pubBusy,
  onCopyAsset,
  onAddToLibrary,
  onDownloadAsset,
  toc,
  topicStatus,
  bookValidated,
  onPublishToLibrary,
  onPublishDownload,
}: {
  styles: Styles;
  isOwner: boolean;
  artifacts: ArtifactDetailView[];
  inputs: ProjectInputView[];
  pubBusy: string | null;
  onCopyAsset: (versionId: string, fmt: "text" | "markdown", title: string) => void;
  onAddToLibrary: (versionId: string, title: string, format: string) => void;
  onDownloadAsset: (versionId: string, title: string, fmt: "epub" | "pdf") => void;
  toc: StructuredTocView | undefined;
  topicStatus: TopicStatusView[];
  bookValidated: boolean;
  onPublishToLibrary: () => void;
  onPublishDownload: (fmt: "epub" | "pdf") => void;
}) {
  const [mode, setMode] = useState<"whole" | "topic">("whole");
  const hasToc = (toc?.subjects?.length ?? 0) > 0;
  const totalTopics = toc?.subjects.reduce((sum, s) => sum + s.units.length, 0) ?? 0;
  const validatedTopics = topicStatus.filter((s) => s.status === "validated").length;

  const publishable = artifacts
    .map(({ artifact, versions }) => {
      const validated = versions.filter((v) => v.is_validated);
      const latest = validated[validated.length - 1];
      return latest ? { artifact, version: latest } : null;
    })
    .filter((x): x is { artifact: ArtifactDetailView["artifact"]; version: ArtifactDetailView["versions"][number] } => x !== null);

  return (
    <View style={styles.artifactsWrap}>
      {hasToc ? (
        <View style={styles.kindRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Whole book"
            accessibilityState={{ selected: mode === "whole" }}
            style={[styles.kindBtn, mode === "whole" ? styles.kindBtnActive : null]}
            onPress={() => setMode("whole")}
          >
            <Text style={mode === "whole" ? styles.kindTextActive : styles.kindText}>Whole book</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Per topic"
            accessibilityState={{ selected: mode === "topic" }}
            style={[styles.kindBtn, mode === "topic" ? styles.kindBtnActive : null]}
            onPress={() => setMode("topic")}
          >
            <Text style={mode === "topic" ? styles.kindTextActive : styles.kindText}>Per topic</Text>
          </Pressable>
        </View>
      ) : null}
      {hasToc && mode === "topic" ? (
        <View style={styles.artifactsWrap}>
          <View style={styles.rollupHeader}>
            <Text style={styles.rollupText}>{validatedTopics}/{totalTopics} topics validated</Text>
            <Chip label={bookValidated ? "Book validated ✓" : "Not yet book-validated"} active={bookValidated} />
          </View>
          {isOwner ? (
            <View style={styles.artifact}>
              <Text style={styles.artifactTitle}>Publish book</Text>
              <View style={styles.pubActions}>
                <Button
                  variant="primary"
                  label="Add to Library"
                  onPress={onPublishToLibrary}
                  busy={pubBusy === "book:lib"}
                  disabled={!bookValidated || pubBusy !== null}
                  accessibilityLabel="Add book to Library"
                />
                <Button
                  variant="primary"
                  label="Download EPUB"
                  onPress={() => onPublishDownload("epub")}
                  busy={pubBusy === "book:epub"}
                  disabled={!bookValidated || pubBusy !== null}
                  accessibilityLabel="Download book as EPUB"
                />
                <Button
                  variant="primary"
                  label="Download PDF"
                  onPress={() => onPublishDownload("pdf")}
                  busy={pubBusy === "book:pdf"}
                  disabled={!bookValidated || pubBusy !== null}
                  accessibilityLabel="Download book as PDF"
                />
              </View>
              {!bookValidated ? (
                <Text style={styles.emptyText}>Validate all topics first — {validatedTopics}/{totalTopics}</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
      {mode === "whole" && publishable.length === 0 ? (
        <Text style={styles.emptyText}>Nothing to publish yet — approve a version under Feedback, then export it here.</Text>
      ) : null}
      {mode === "whole" && publishable.length > 0 ? (
        <>
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
                <Button
                  variant="primary"
                  label="Add to Library"
                  onPress={() => onAddToLibrary(version.id, title, artifact.format)}
                  busy={pubBusy === `${version.id}:lib`}
                  disabled={pubBusy !== null}
                  accessibilityLabel={`Add ${title} to Library`}
                />
                <Button
                  variant="primary"
                  label="Download EPUB"
                  onPress={() => onDownloadAsset(version.id, title, "epub")}
                  busy={pubBusy === `${version.id}:epub`}
                  disabled={pubBusy !== null}
                  accessibilityLabel={`Download ${title} as EPUB`}
                />
                <Button
                  variant="primary"
                  label="Download PDF"
                  onPress={() => onDownloadAsset(version.id, title, "pdf")}
                  busy={pubBusy === `${version.id}:pdf`}
                  disabled={pubBusy !== null}
                  accessibilityLabel={`Download ${title} as PDF`}
                />
              </View>
            ) : (
              <>
                <View style={styles.pubActions}>
                  <Button
                    variant="primary"
                    label="Copy"
                    onPress={() => onCopyAsset(version.id, "text", title)}
                    busy={pubBusy === `${version.id}:text`}
                    disabled={pubBusy !== null}
                    accessibilityLabel={`Copy ${title} as text`}
                  />
                  <Button
                    variant="primary"
                    label="Copy as Markdown"
                    onPress={() => onCopyAsset(version.id, "markdown", title)}
                    busy={pubBusy === `${version.id}:markdown`}
                    disabled={pubBusy !== null}
                    accessibilityLabel={`Copy ${title} as Markdown`}
                  />
                </View>
                <Text style={styles.proText}>PDF & Word — Pro (coming soon)</Text>
              </>
            )}
          </View>
        );
      })}
        </>
      ) : null}
    </View>
  );
}

function TrustProjectDetailInner() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { project, loading, error, refresh, generateFormat, generateTopic, invite, addInput, editInput, removeInput, loadVersionContent, suggestToc, saveToc, inputs: sourceInputs, accessToken } = useTrustProject(String(projectId));
  const inputs = sourceInputs ?? [];
  const [inviteEmail, setInviteEmail] = useState("");
  const [pubBusy, setPubBusy] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [genBusyFormat, setGenBusyFormat] = useState<string | null>(null);
  // A MAP of in-flight topic ids to their progress, not a single id: the
  // Celery worker runs per-topic generations concurrently, and —
  // more importantly — a single `busyTopicId` string forced
  // `disabled={busyTopicId !== null}` to grey EVERY topic's Generate while
  // one ran (the "all Not-generated greyed, no option to generate" report).
  // Per-id busy gates each row independently; the value also carries the
  // startedAt/phase the per-row progress bar renders.
  const [topicGen, setTopicGen] = useState<ReadonlyMap<string, GenProgress>>(new Map());
  const [sourceKind, setSourceKind] = useState<"transcript" | "note" | "link">("note");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceContent, setSourceContent] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [addSourceBusy, setAddSourceBusy] = useState(false);
  const [selected, setSelected] = useState<PhaseKey | null>(null);
  const [desiredDraftMode, setDesiredDraftMode] = useState<"whole" | "topic">("whole");
  const [compareArtifactId, setCompareArtifactId] = useState<string | null>(null);
  const [compareSel, setCompareSel] = useState<string[]>([]);
  const [tocDraft, setTocDraft] = useState<StructuredTOC | null>(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  // Debounces the network `saveToc` triggered by TOC edits — every keystroke
  // in TopicTreeEditor calls onChangeToc, and firing a full-TOC PATCH per
  // character both floods the network and risks an out-of-order last-write
  // (an earlier PATCH resolving after a later one leaves the server stale).
  // setTocDraft below stays synchronous so the UI never waits on this.
  const saveTocTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // id -> "S1".."Sn", mirroring the draft viewer's labelFor (app/trust/version/[versionId].tsx).
  const sourceLabel = useMemo(() => {
    const m = new Map<string, string>();
    inputs.forEach((inp, i) => m.set(inp.id, `S${i + 1}`));
    return (id: string) => m.get(id) ?? "cited";
  }, [inputs]);

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

  // Same "seed once" shape as the `selected` effect above: pull the Structure
  // draft from the persisted toc the first time the project is available,
  // then leave it alone. saveToc/addInput/etc. all refetch the project on
  // success, and we must not let that refetch stomp in-progress local edits.
  useEffect(() => {
    if (project && tocDraft === null) {
      setTocDraft(project.project.toc ? tocViewToStructured(project.project.toc) : { subjects: [] });
    }
  }, [project, tocDraft]);

  // Clear a pending debounced saveToc on unmount so navigating away mid-type
  // never fires a late write after the screen (and its onChangeToc closure
  // over stale project state) is gone.
  useEffect(() => {
    return () => {
      if (saveTocTimer.current) clearTimeout(saveTocTimer.current);
    };
  }, []);

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

  const onGenerateTopic = async (topicId: string) => {
    setTopicGen((cur) => new Map(cur).set(topicId, { startedAt: Date.now(), phase: "queued" }));
    try {
      await generateTopic(topicId, {
        onPhase: (phase) => setTopicGen((cur) => {
          const p = cur.get(topicId);
          if (!p) return cur;
          const next = new Map(cur);
          next.set(topicId, { ...p, phase });
          return next;
        }),
      });
    } catch (e) {
      Alert.alert("Couldn't generate", e instanceof ApiError ? e.userMessage() : e instanceof Error ? e.message : "Try again.");
    } finally {
      setTopicGen((cur) => {
        const next = new Map(cur);
        next.delete(topicId);
        return next;
      });
    }
  };

  const onOpenTopic = (versionId: string) =>
    router.push(`/trust/topic-version/${versionId}?projectId=${projectId}`);

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

  // Assembles the current TOC's validated topic drafts into one multi-topic
  // Book (T1's topicsToBook), fetching each topic's latest validated version
  // content on demand. Feeds both onPublishToLibrary and onPublishDownload —
  // mirroring how the whole-book handlers share loadVersionContent + a Book.
  const assembleBook = async (): Promise<Book> => {
    if (!accessToken) throw new Error("Not signed in");
    const toc = project.project.toc ?? { subjects: [] };
    const statusByTopic = new Map((project.topic_status ?? []).map((s) => [s.topic_id, s]));
    const sectionsByTopic = new Map<string, DraftSection[]>();
    for (const subject of toc.subjects) {
      for (const unit of subject.units) {
        const status = statusByTopic.get(unit.id);
        if (status?.latest_version_id) {
          const tv = await getTopicVersion(status.latest_version_id, accessToken);
          sectionsByTopic.set(unit.id, tv.content?.sections ?? []);
        }
      }
    }
    return topicsToBook(project.project.title, toc, sectionsByTopic, inputs);
  };

  const onPublishToLibrary = () => {
    setPubBusy("book:lib");
    void (async () => {
      try {
        const book = await assembleBook();
        await saveBook(book);
        Alert.alert("Added", "Added to your Library.");
      } catch (e) {
        Alert.alert("Couldn't add", e instanceof ApiError ? e.userMessage() : "Please try again.");
      } finally {
        setPubBusy(null);
      }
    })();
  };

  const onPublishDownload = (fmt: "epub" | "pdf") => {
    setPubBusy(`book:${fmt}`);
    void (async () => {
      try {
        const book = await assembleBook();
        const res = await trackedExport(book, fmt, { diagrams: true });
        await downloadArtifact(
          res.artifact,
          `${slug(project.project.title)}.${fmt}`,
          fmt === "epub" ? "application/epub+zip" : "application/pdf",
        );
      } catch (e) {
        Alert.alert("Couldn't download", e instanceof ApiError ? e.userMessage() : "Please try again.");
      } finally {
        setPubBusy(null);
      }
    })();
  };

  const onAddSource = async () => {
    const title = sourceTitle.trim() || undefined;
    const body =
      sourceKind === "link"
        ? (() => {
            const url = sourceUrl.trim();
            return url ? { kind: "link" as const, title, content: url, source_ref: url } : null;
          })()
        : (() => {
            const content = sourceContent.trim();
            return content ? { kind: sourceKind, title, content } : null;
          })();
    if (!body) return;
    setAddSourceBusy(true);
    try {
      await addInput(body);
      setSourceTitle("");
      setSourceContent("");
      setSourceUrl("");
      setSourceKind("note");
    } catch (e) {
      Alert.alert("Couldn't add source", e instanceof ApiError ? e.userMessage() : "Please try again.");
    } finally {
      setAddSourceBusy(false);
    }
  };

  const toc: StructuredTOC = tocDraft ?? { subjects: [] };

  const onSuggest = async () => {
    // Re-entry guard: Alert.alert doesn't block, so without this a second tap
    // while the confirm-replace prompt is still open would fire another
    // suggestToc call and stack a second dialog.
    if (suggestBusy) return;
    setSuggestBusy(true);
    try {
      const suggested = tocViewToStructured(await suggestToc());
      const apply = async () => {
        // An armed keystroke-debounce timer firing after this save would
        // clobber the just-persisted suggested outline with a stale edit —
        // invisible until reload. Disarm it before applying/saving.
        if (saveTocTimer.current) {
          clearTimeout(saveTocTimer.current);
          saveTocTimer.current = null;
        }
        setTocDraft(suggested);
        try {
          await saveToc(structuredToTocView(suggested));
        } catch {
          // Non-fatal: the suggested outline stays visible locally even if
          // the persist call failed; the next edit (or another Suggest)
          // will retry the save.
        } finally {
          setSuggestBusy(false);
        }
      };
      if (tocHasContent(toc)) {
        // Busy stays true across the prompt — cleared by whichever button
        // fires (Cancel below, or `apply`'s finally on Replace).
        Alert.alert(
          "Replace outline?",
          "This replaces your current outline with the suggested one.",
          [
            { text: "Cancel", style: "cancel", onPress: () => setSuggestBusy(false) },
            { text: "Replace", style: "destructive", onPress: () => { void apply(); } },
          ],
        );
        return;
      }
      await apply();
    } catch (e) {
      Alert.alert("Couldn't suggest", e instanceof ApiError ? e.userMessage() : "Try again.");
      setSuggestBusy(false);
    }
  };

  const onChangeToc = (next: StructuredTOC) => {
    setTocDraft(next);
    if (saveTocTimer.current) clearTimeout(saveTocTimer.current);
    saveTocTimer.current = setTimeout(() => {
      void saveToc(structuredToTocView(next)).catch(() => {});
    }, 700);
  };

  const isOwner = project.my_role === "owner";
  const phase = deriveProjectPhase(project, isOwner);
  // Fallback for the first frame(s) before the seed effect fires; once
  // `selected` is set it wins and no longer tracks phase changes.
  const active = selected ?? basePhase(phase.currentKey);
  const anyVersion = project.artifacts.some((a) => a.versions.length > 0);

  // The single next action that moves an owner toward a first working AI
  // draft — Add a source / Suggest a structure / Generate a topic. Pure
  // (@/lib/nextStep); returns null for reviewers and once a topic is
  // drafted, so the banner self-retires once the loop is underway.
  const step = nextStep({
    isOwner,
    inputCount: inputs.length,
    tocSubjectCount: project.project.toc?.subjects?.length ?? 0,
    // Goal reached on ANY draft — a per-topic draft OR a whole-book artifact
    // version — so the banner never nags after a real draft exists.
    anyDraftExists:
      (project.topic_status ?? []).some(
        (s) => s.status === "drafted" || s.status === "validated",
      ) || (project.artifacts ?? []).some((a) => a.versions.length > 0),
  });
  const onStepPress = () => {
    if (!step) return;
    if (step.target.draftMode) setDesiredDraftMode(step.target.draftMode);
    setSelected(step.target.phase);
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
      <PageContainer>
        <Text style={styles.title}>{project.project.title}</Text>
        {project.project.topic ? <Text style={styles.topic}>{project.project.topic}</Text> : null}
        {step ? (
          <Card style={styles.nextStepCard}>
            <Text style={styles.nextStepTitle}>{step.title}</Text>
            <Text style={styles.nextStepBody}>{step.body}</Text>
            <Button
              variant="primary"
              label={step.ctaLabel}
              onPress={onStepPress}
              accessibilityLabel={step.ctaLabel}
              style={styles.nextStepBtn}
            />
          </Card>
        ) : null}
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
            sourceUrl={sourceUrl}
            setSourceUrl={setSourceUrl}
            addSourceBusy={addSourceBusy}
            onAddSource={onAddSource}
            editInput={editInput}
            removeInput={removeInput}
          />
        ) : null}
        {active === "structure" ? (
          <StructurePanel
            styles={styles}
            isOwner={isOwner}
            toc={toc}
            onChangeToc={onChangeToc}
            onSuggest={onSuggest}
            suggestBusy={suggestBusy}
            sourceLabel={sourceLabel}
            inputsEmpty={inputs.length === 0}
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
            toc={project.project.toc}
            topicStatus={project.topic_status ?? []}
            topicGen={topicGen}
            onGenerateTopic={onGenerateTopic}
            onOpenTopic={onOpenTopic}
            initialMode={desiredDraftMode}
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
            toc={project.project.toc}
            topicStatus={project.topic_status ?? []}
            bookValidated={project.book_validated ?? false}
            onOpenTopic={onOpenTopic}
          />
        ) : null}
        {active === "share" ? (
          <PublishPanel
            styles={styles}
            isOwner={isOwner}
            artifacts={project.artifacts}
            inputs={inputs}
            pubBusy={pubBusy}
            onCopyAsset={onCopyAsset}
            onAddToLibrary={onAddToLibrary}
            onDownloadAsset={onDownloadAsset}
            toc={project.project.toc}
            topicStatus={project.topic_status ?? []}
            bookValidated={project.book_validated ?? false}
            onPublishToLibrary={onPublishToLibrary}
            onPublishDownload={onPublishDownload}
          />
        ) : null}
        <PhaseNav phaseKey={active} onSelect={setSelected} />
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
  // The adaptive "what to do next" banner — self-retires once nextStep()
  // returns null (reviewer, or a topic is already drafted).
  nextStepCard: { gap: spacing.sm, marginBottom: spacing.md },
  nextStepTitle: { color: c.text, fontSize: typography.sizeLg, fontFamily: FRAUNCES.semibold, letterSpacing: -0.36 },
  nextStepBody: { color: c.textMuted, fontSize: typography.sizeSm },
  nextStepBtn: { alignSelf: "flex-start" as const },
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
  // flexGrow/minWidth belong on the Pressable — it's the actual flex ITEM
  // inside genGrid's row/wrap; flexGrow only distributes among a flex
  // container's immediate children, so putting it on the nested <Card>
  // (a grandchild) doesn't stretch the tile to fill wrapped rows.
  genCardPressable: { minWidth: 140, flexGrow: 1 },
  // Bespoke gap only — the surface, border, and padding now come from
  // <Card>, which this style overrides onto (Studio re-skin P1). alignSelf:
  // stretch so the Card fills the Pressable's full (grown) width rather than
  // shrink-wrapping its content.
  genCard: { alignSelf: "stretch" as const, gap: 2 },
  // Inter (body), not Playfair — sizeSm (14px) is below the "Playfair only
  // >=16px" legibility floor (final-review finding). fontWeight carries the
  // emphasis instead, matching the kindText tile-label treatment below.
  genCardLabel: { color: c.text, fontSize: typography.sizeSm, fontWeight: "600" as const },
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
  structureBlock: {
    backgroundColor: c.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  structureActions: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm },
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
  // Bespoke spacing only — the surface, border, and padding now come from
  // <Card>, which this style overrides onto (Studio re-skin P1); the eyebrow
  // kind label moved to <Label>.
  sourceRow: { marginTop: spacing.sm, gap: 2 },
  sourceRowTitle: { color: c.text, fontSize: typography.sizeSm },
  sourceRowDate: { color: c.textMuted, fontSize: typography.sizeXs },
  sourceDetail: { gap: spacing.sm, paddingTop: spacing.sm },
  sourceDetailContent: { color: c.text, fontSize: typography.sizeSm },
  sourceActionsRow: { flexDirection: "row" as const, gap: spacing.sm },
  artifactsWrap: { gap: spacing.md },
  compareRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm },
  // The standalone "Compare versions…" <Button> sits in a column (`.artifact`)
  // whose default cross-axis is stretch — this keeps it from growing full-width.
  compareBtnAlign: { alignSelf: "flex-start" as const },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: radius.sm,
    borderWidth: 2 as const,
    borderColor: c.border,
    backgroundColor: c.surfaceHigh,
  },
  checkboxOn: { backgroundColor: c.primary, borderColor: c.primary },
  // Column, not row: this wraps the title+actions line AND (when a topic is
  // generating) the full-width progress bar stacked beneath it. The row
  // semantics (space-between, centered, horizontal) live on topicRowMain so
  // the bar isn't crammed onto the same line as the title/buttons.
  topicRow: {
    flexDirection: "column" as const,
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  topicRowMain: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: spacing.sm,
    width: "100%" as const,
  },
  topicRowLeft: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm, flexShrink: 1 as const },
  // Inter (body), not Playfair — sizeSm sits below the "Playfair only
  // >=16px" legibility floor (see genCardLabel above), so weight carries
  // the emphasis instead.
  topicRowTitle: { color: c.text, fontSize: typography.sizeSm, fontWeight: "600" as const, flexShrink: 1 as const },
  topicRowActions: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm },
  rollupHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.md,
  },
  rollupText: { color: c.text, fontSize: typography.sizeMd, fontWeight: "600" as const },
});
