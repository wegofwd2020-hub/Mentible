import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { EngineBadge } from "@/components/EngineBadge";
import { PageContainer } from "@/components/PageContainer";
import { PhaseTabBar } from "@/components/PhaseTabBar";
import { PhaseNav } from "@/components/PhaseNav";
import { TopicTreeEditor } from "@/components/TopicTreeEditor";
import { Mp3UploadSheet } from "@/components/trust/Mp3UploadSheet";
import type { PickedAudio } from "@/api/audioUpload";
import { Alert } from "@/lib/alert";
import { useTrustProject } from "@/hooks/useTrustProject";
import { ApiError, exportBook } from "@/api/client";
import { copyText } from "@/lib/clipboard";
import { sectionsToMarkdown, sectionsToPlainText } from "@/lib/draftExport";
import { artifactToBook, provenanceFromMeta } from "@/lib/artifactToBook";
import { topicsToBook } from "@/lib/topicsToBook";
import { saveBook } from "@/storage/bookStore";
import { trackedExport } from "@/lib/trackedExport";
import { downloadArtifact, saveEpub } from "@/storage/epubLibrary";
import { randomUUID } from "@/lib/uuid";
import { estimateBook, generateBook, getGenerationJob, getTopicVersion, latestGenerationJob, listProjectFeedback } from "@/api/trustClient";
import type { ArtifactDetailView, DraftSection, GenerationJob, ProjectFeedbackItem, ProjectInputView, ProjectView, StructuredTocUnit, StructuredTocView, TopicStatusView } from "@/api/trustClient";
import { loadApiKey } from "@/secure/keyStore";
import type { PlanStatus } from "@/api/billingClient";
import type { Book, BookMetadata, StructuredTOC, Subtopic } from "@/types/book";
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
import { useBillingPlan } from "@/hooks/useBillingPlan";

type Styles = ReturnType<typeof makeStyles>;
type ThemeShape = ReturnType<typeof useTheme>;

type GenProgress = { startedAt: number; phase: "queued" | "running" };

// Whole-book generation progress polling cadence (T6) — the same 3s cadence
// pollJob's callers use elsewhere in this file, applied by hand here since
// this polls the durable Postgres `generation_job` row (GET
// /generation-jobs/{id}) rather than the ephemeral Redis job status pollJob
// targets, so it can't reuse pollJob's fetch shape directly.
const BOOK_GEN_POLL_MS = 3_000;

// Renders the whole-book generation status line(s) for a `generation_job`
// row, whichever surface produced it (the active local poll, or the
// on-focus latest-job fetch when there's no local job). `queued` -> a
// "starting" line so the pre-`running` window reads as in-progress rather
// than a bare 0/N; `running` -> the in-progress line; `done`/`halted` -> the
// on-return "ready" line with the failed topic ids so the owner knows what
// to regenerate via the existing per-topic Generate; `failed` (the outer
// except + early infra-failure exits in `_run_book`, e.g. managed-key/BYOK
// envelope problems) -> a clear "try again" line, so a poll that caught the
// job mid-progress doesn't just vanish with no explanation. Fetch errors are
// handled separately (fail-open, unchanged) — this is only about a
// successfully-fetched job whose status is `failed`.
// Threads the project's rights attestation (B3 Part B) into the exported
// book's dc:rights colophon line. compiler/src/colophon.ts already falls
// back to "© <year> <author>. All rights reserved." when metadata.rights is
// absent, so this only needs to supply a line when the OWNER has actually
// attested AND named a rights holder — an unattested project exports with
// the compiler's default colophon behavior, unchanged.
function rightsMetadata(project: ProjectView): BookMetadata | undefined {
  if (!project.rights_attested_at || !project.rights_holder) return undefined;
  const year = new Date(project.rights_attested_at).getUTCFullYear();
  return { rights: `© ${year} ${project.rights_holder}. All rights reserved.` };
}

function BookGenSurface({ job, styles }: { job: GenerationJob; styles: Styles }) {
  if (job.status === "queued") {
    return <Text style={styles.genHint}>Starting…</Text>;
  }
  if (job.status === "running") {
    return <Text style={styles.genHint}>{`Generating chapters… ${job.done}/${job.total}`}</Text>;
  }
  if (job.status === "done" || job.status === "halted") {
    return (
      <View>
        <Text style={styles.emptyText}>
          {`Book generated ✓ (${job.done}/${job.total} · ${job.failed_topic_ids.length} failed)`}
        </Text>
        {job.failed_topic_ids.length > 0 ? (
          <Text style={styles.genHint}>{`Failed: ${job.failed_topic_ids.join(", ")}`}</Text>
        ) : null}
      </View>
    );
  }
  if (job.status === "failed") {
    return <Text style={styles.genError}>Generation failed — try again.</Text>;
  }
  return null;
}

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

// Long-form assets get real Add-to-Library + EPUB/PDF/Word export in Publish
// (they reuse the same book/compiler machinery as authored Books); social
// assets (linkedin/x_thread/reel/podcast) stay Copy-only.
const LONG_FORM = new Set(["book", "essay", "guide"]);

const slug = (t: string) =>
  t.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "asset";

const EXPORT_MIME: Record<"epub" | "pdf" | "docx", string> = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

// Per-format download gate (T5), independent of the whole-group `walled` Free
// wall below: `plan == null` (signed out / still loading / a failed billing
// fetch) fails OPEN — the button shows and the server's 402 is the real gate.
// A known plan must carry `export_<fmt>` in its `features` array.
function canExport(plan: PlanStatus | null, fmt: "epub" | "pdf" | "docx"): boolean {
  return plan == null || plan.features?.includes(`export_${fmt}`) === true;
}

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

// Meta line for a Revision-notes row: "who · when", omitting the timestamp
// when created_at is missing/unparseable rather than leaving a trailing "· ".
function revisionMetaText(item: ProjectFeedbackItem): string {
  const who = item.author_name ?? item.author_kind;
  const ts = versionTimestamp(item.created_at);
  return ts ? `${who} · ${ts}` : who;
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
  onTranscribe,
  onTranscribed,
  transcripts,
  onOpenTranscript,
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
  onTranscribe: (asset: PickedAudio, opts: { title?: string; language: string }) => Promise<{ artifact_id: string; version_id: string }>;
  onTranscribed: (r: { artifact_id: string; version_id: string }) => void;
  transcripts: { id: string; title: string; versionId: string; versionNo: number; validated: boolean }[];
  onOpenTranscript: (artifactId: string, versionId: string) => void;
  editInput: (inputId: string, body: { title?: string; content?: string; source_ref?: string }) => Promise<ProjectInputView>;
  removeInput: (inputId: string) => Promise<void>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [transcribeBusy, setTranscribeBusy] = useState(false);
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

  const onSubmitAudio = (asset: PickedAudio, opts: { title?: string; language: string }) => {
    setTranscribeBusy(true);
    void (async () => {
      try {
        const r = await onTranscribe(asset, opts);
        setUploadOpen(false);
        onTranscribed(r);
      } catch (e) {
        Alert.alert("Couldn't transcribe", e instanceof ApiError ? e.userMessage() : e instanceof Error ? e.message : "Please try again.");
      } finally {
        setTranscribeBusy(false);
      }
    })();
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
      {isOwner ? (
        <Card style={styles.captureCard}>
          <Text style={styles.captureCardTitle}>Upload interview (audio)</Text>
          <Text style={styles.captureCardHelper}>
            Transcribe an mp3, m4a, or wav recording into an editable transcript.
          </Text>
          <Button
            variant="ghost"
            label="Upload interview (audio)"
            onPress={() => setUploadOpen(true)}
            busy={transcribeBusy}
            accessibilityLabel="Upload interview audio"
          />
        </Card>
      ) : null}
      {isOwner && transcripts.length > 0 ? (
        <View>
          <Text style={styles.artifactTitle}>Transcripts</Text>
          {transcripts.map((t) => (
            <Pressable
              key={t.id}
              accessibilityRole="button"
              accessibilityLabel={`Open transcript ${t.title}`}
              style={styles.sourceRow}
              onPress={() => onOpenTranscript(t.id, t.versionId)}
            >
              <Label tone="secondary">Transcript</Label>
              <Text style={styles.sourceRowTitle}>{t.title}</Text>
              <Text style={styles.sourceRowDate}>
                v{t.versionNo}
                {t.validated ? " · Validated ✓" : " · Review & approve"}
              </Text>
            </Pressable>
          ))}
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
      <Mp3UploadSheet
        visible={uploadOpen}
        busy={transcribeBusy}
        onClose={() => setUploadOpen(false)}
        onSubmit={onSubmitAudio}
      />
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
  suggestGen,
  suggestElapsedMs,
  sourceLabel,
  inputsEmpty,
  atGenerationCap,
}: {
  styles: Styles;
  isOwner: boolean;
  toc: StructuredTOC;
  onChangeToc: (next: StructuredTOC) => void;
  onSuggest: () => void;
  suggestBusy: boolean;
  suggestGen: { startedAt: number; phase: "queued" | "running" } | null;
  suggestElapsedMs: number;
  sourceLabel: (id: string) => string;
  inputsEmpty: boolean;
  // Free-plan generation cap (T4) — UX only, fails open when the plan is
  // unknown (see atGenerationCap's derivation in TrustProjectDetailInner).
  // The server (T2) is the real gate; a 402 here still shows the upgrade
  // Alert from onSuggest's catch.
  atGenerationCap: boolean;
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
              disabled={inputsEmpty || atGenerationCap}
              accessibilityLabel="Suggest outline from sources"
            />
          </View>
          {suggestGen ? <GenerateProgressBar phase={suggestGen.phase} elapsedMs={suggestElapsedMs} /> : null}
          {inputsEmpty ? <Text style={styles.emptyText}>Add a source first</Text> : null}
          {!inputsEmpty && atGenerationCap ? (
            <Text style={styles.emptyText}>Free limit reached — upgrade to Pro</Text>
          ) : null}
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
  formatGen,
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
  atGenerationCap,
  onGenerateBook,
  bookGenBusy,
  bookGenJob,
}: {
  styles: Styles;
  isOwner: boolean;
  artifacts: ArtifactDetailView[];
  inputs: ProjectInputView[];
  formatGen: ReadonlyMap<string, GenProgress>;
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
  // Free-plan generation cap (T4) — UX only, fails open when the plan is
  // unknown. The server (T2) is the real gate; a 402 here still shows the
  // upgrade Alert from onGenerateFormat/onGenerateTopic's catch.
  atGenerationCap: boolean;
  // Whole-book generate fan-out (ADR-037 book generation, T5) — the pre-run
  // estimate/confirm and submit both live in the parent (TrustProjectDetailInner);
  // this panel only renders the button + busy state.
  onGenerateBook: () => void;
  bookGenBusy: boolean;
  // Progress + on-return "ready" surface (T6) — either the actively-polled
  // local job or the latest job fetched on focus when there's no local one.
  // null whenever there's nothing to show (no job yet, or the last fetch
  // failed — fail-open, see BookGenSurface above and the effects in
  // TrustProjectDetailInner).
  bookGenJob: GenerationJob | null;
}) {
  const [mode, setMode] = useState<"whole" | "topic">(initialMode ?? "whole");
  const hasToc = (toc?.subjects?.length ?? 0) > 0;
  const statusByTopic = new Map(topicStatus.map((s) => [s.topic_id, s]));
  // A book-generation job already in flight (queued/running) — distinct from
  // bookGenBusy (the local estimate/submit flag, reset in onGenerateBook's
  // `finally` well before the durable job finishes). Without this, the button
  // re-enables the moment the confirm dialog's submit resolves, letting the
  // owner launch a SECOND concurrent book job that re-generates every topic
  // the first hasn't reached yet.
  const bookGenActive = bookGenJob?.status === "queued" || bookGenJob?.status === "running";

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
                            disabled={isBusy || atGenerationCap}
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
                    {isOwner && !isBusy && atGenerationCap ? (
                      <Text style={styles.emptyText}>Free limit reached — upgrade to Pro</Text>
                    ) : null}
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
                  const prog = formatGen.get(f.format);
                  const busy = prog !== undefined;
                  const disabled = busy || inputs.length === 0 || atGenerationCap;
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
                        <Text style={styles.genPlus}>{busy ? "…" : "+"}</Text>
                        {prog ? <TopicRowProgress startedAt={prog.startedAt} phase={prog.phase} /> : null}
                      </Card>
                    </Pressable>
                  );
                })}
              </View>
              {inputs.length === 0 ? <Text style={styles.emptyText}>Add a source first</Text> : null}
              {inputs.length > 0 && atGenerationCap ? (
                <Text style={styles.emptyText}>Free limit reached — upgrade to Pro</Text>
              ) : null}
            </View>
          ) : null}
          {isOwner && hasToc ? (
            <View style={styles.genBlock}>
              <Text style={styles.artifactTitle}>Generate the whole book</Text>
              <Text style={styles.genHint}>
                Generates every topic in the outline that doesn't have a draft yet, one after another.
              </Text>
              <Button
                variant="primary"
                label="Generate full book"
                onPress={onGenerateBook}
                busy={bookGenBusy}
                disabled={bookGenBusy || atGenerationCap || bookGenActive}
                accessibilityLabel="Generate full book"
              />
              {atGenerationCap ? (
                <Text style={styles.emptyText}>Free limit reached — upgrade to Pro</Text>
              ) : null}
              {bookGenJob ? <BookGenSurface job={bookGenJob} styles={styles} /> : null}
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
  inviteRole,
  setInviteRole,
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
  feedbackLog,
}: {
  styles: Styles;
  theme: ThemeShape;
  isOwner: boolean;
  artifacts: ArtifactDetailView[];
  anyVersion: boolean;
  inviteEmail: string;
  setInviteEmail: (v: string) => void;
  inviteRole: "reviewer" | "editor";
  setInviteRole: (v: "reviewer" | "editor") => void;
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
  feedbackLog: ProjectFeedbackItem[];
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
          {/* Reviewer (default) can approve/withdraw; editor can edit/create
              versions. Mirrors the backend InviteIn.role matrix (Task 4). */}
          <View style={styles.kindRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Invite as reviewer"
              accessibilityState={{ selected: inviteRole === "reviewer" }}
              style={[styles.kindBtn, inviteRole === "reviewer" ? styles.kindBtnActive : null]}
              onPress={() => setInviteRole("reviewer")}
            >
              <Text style={inviteRole === "reviewer" ? styles.kindTextActive : styles.kindText}>Reviewer</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Invite as editor"
              accessibilityState={{ selected: inviteRole === "editor" }}
              style={[styles.kindBtn, inviteRole === "editor" ? styles.kindBtnActive : null]}
              onPress={() => setInviteRole("editor")}
            >
              <Text style={inviteRole === "editor" ? styles.kindTextActive : styles.kindText}>Editor</Text>
            </Pressable>
          </View>
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
      {/* Project-wide, read-only revision log (T2) — every feedback note
          across every draft (whole-book AND per-topic), newest-first
          (server-ordered). Sits below the whole/topic review content, set
          apart by its own header + a top divider so the panel doesn't read
          as one blob. Independent of the whole/topic toggle above. */}
      <View style={styles.revisionSection}>
        <Text style={styles.artifactTitle}>Revision notes</Text>
        {feedbackLog.length === 0 ? (
          <Text style={styles.emptyText}>No revision notes yet.</Text>
        ) : (
          feedbackLog.map((item, i) => (
            <Card key={`${item.source}-${item.draft_label}-${item.version_no}-${i}`} style={styles.revisionRow}>
              <Label tone="secondary">{item.draft_label} · v{item.version_no}</Label>
              <Text style={styles.revisionBody} numberOfLines={6}>{item.body}</Text>
              <Text style={styles.revisionMeta}>{revisionMetaText(item)}</Text>
            </Card>
          ))
        )}
      </View>
    </View>
  );
}

// Publish (share phase): export each APPROVED asset's validated version as plain
// text or Markdown (client-side; content fetched on demand), or — for long-form
// assets — as EPUB/PDF/Word. Each of EPUB/PDF/Word is gated per-format on the
// plan's `features` (`canExport`, T5); a Free user instead sees a single
// "Upgrade to Pro to download" control for the whole group (`walled`, unchanged).
// A `Whole book | Per topic` toggle (only rendered once the project has a TOC —
// Slice D, mirroring the C2b/C2c toggles) switches to a rollup header
// (`{validated}/{total} topics validated` + book_validated indicator) plus a
// Publish-book block: Add to Library / Download EPUB / Download PDF, gated on
// `bookValidated` and owner-only (the assembly itself is an owner action).
function PublishPanel({
  styles,
  theme,
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
  onUpgrade,
  plan,
  rightsAttestedAt,
  rightsHolderDraft,
  setRightsHolderDraft,
  rightsBusy,
  onToggleRights,
  onSaveRightsHolder,
}: {
  styles: Styles;
  theme: Palette;
  isOwner: boolean;
  artifacts: ArtifactDetailView[];
  inputs: ProjectInputView[];
  pubBusy: string | null;
  onCopyAsset: (versionId: string, fmt: "text" | "markdown", title: string) => void;
  onAddToLibrary: (versionId: string, title: string, format: string) => void;
  onDownloadAsset: (versionId: string, title: string, fmt: "epub" | "pdf" | "docx") => void;
  toc: StructuredTocView | undefined;
  topicStatus: TopicStatusView[];
  bookValidated: boolean;
  onPublishToLibrary: () => void;
  onPublishDownload: (fmt: "epub" | "pdf" | "docx") => void;
  onUpgrade: () => void;
  // Single source of truth (T4): fetched once in TrustProjectDetailInner and
  // threaded down, rather than each panel calling useBillingPlan itself.
  // Client-side UX only (T3) — the server (T2) is the real gate on export
  // submission. plan:null means "unknown" (signed out, still loading, or the
  // billing fetch failed) and must fail OPEN — never wall on a billing hiccup.
  plan: PlanStatus | null;
  rightsAttestedAt: string | null;
  rightsHolderDraft: string;
  setRightsHolderDraft: (v: string) => void;
  rightsBusy: boolean;
  onToggleRights: () => void;
  onSaveRightsHolder: () => void;
}) {
  const [mode, setMode] = useState<"whole" | "topic">("whole");
  const hasToc = (toc?.subjects?.length ?? 0) > 0;
  const totalTopics = toc?.subjects.reduce((sum, s) => sum + s.units.length, 0) ?? 0;
  const validatedTopics = topicStatus.filter((s) => s.status === "validated").length;
  const walled = plan != null && plan.is_pro === false;

  const publishable = artifacts
    .map(({ artifact, versions }) => {
      const validated = versions.filter((v) => v.is_validated);
      const latest = validated[validated.length - 1];
      return latest ? { artifact, version: latest } : null;
    })
    .filter((x): x is { artifact: ArtifactDetailView["artifact"]; version: ArtifactDetailView["versions"][number] } => x !== null);

  return (
    <View style={styles.artifactsWrap}>
      {isOwner ? (
        <View style={styles.artifact}>
          <Text style={styles.artifactTitle}>Rights</Text>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel="I attest I hold the rights to my sources"
            accessibilityState={{ checked: !!rightsAttestedAt }}
            onPress={onToggleRights}
            style={styles.inviteRow}
          >
            <Chip label={rightsAttestedAt ? "Attested ✓" : "Not attested"} active={!!rightsAttestedAt} />
            <Text style={styles.sourcesHelper}>I attest I hold the rights to the sources I've used and that this is my original work.</Text>
          </Pressable>
          <TextInput
            style={styles.inviteInput}
            accessibilityLabel="Rights holder"
            placeholder="Rights holder (optional)"
            placeholderTextColor={theme.textMuted}
            value={rightsHolderDraft}
            onChangeText={setRightsHolderDraft}
          />
          <Button
            variant="ghost"
            label="Save rights holder"
            accessibilityLabel="Save rights holder"
            busy={rightsBusy}
            onPress={onSaveRightsHolder}
          />
        </View>
      ) : null}
      <Text style={styles.sourcesHelper}>Originality & rights are the author's responsibility — Mentible does not verify copyright or run a plagiarism scan against the web.</Text>
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
                  busyLabel="Compiling EPUB…"
                  disabled={!bookValidated || pubBusy !== null}
                  accessibilityLabel="Add book to Library"
                />
                {walled ? (
                  <Button
                    variant="primary"
                    label="Upgrade to Pro to download"
                    onPress={onUpgrade}
                    accessibilityLabel="Upgrade to Pro to download the book"
                  />
                ) : (
                  <>
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
                    {canExport(plan, "docx") ? (
                      <Button
                        variant="primary"
                        label="Download Word"
                        onPress={() => onPublishDownload("docx")}
                        busy={pubBusy === "book:docx"}
                        disabled={!bookValidated || pubBusy !== null}
                        accessibilityLabel="Download book as Word"
                      />
                    ) : null}
                  </>
                )}
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
                  busyLabel="Compiling EPUB…"
                  disabled={pubBusy !== null}
                  accessibilityLabel={`Add ${title} to Library`}
                />
                {walled ? (
                  <Button
                    variant="primary"
                    label="Upgrade to Pro to download"
                    onPress={onUpgrade}
                    accessibilityLabel={`Upgrade to Pro to download ${title}`}
                  />
                ) : (
                  <>
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
                    {canExport(plan, "docx") ? (
                      <Button
                        variant="primary"
                        label="Download Word"
                        onPress={() => onDownloadAsset(version.id, title, "docx")}
                        busy={pubBusy === `${version.id}:docx`}
                        disabled={pubBusy !== null}
                        accessibilityLabel={`Download ${title} as Word`}
                      />
                    ) : null}
                  </>
                )}
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
                <Text style={styles.proText}>PDF & Word available on book & guide assets</Text>
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
  const { project, loading, error, refresh, generateFormat, generateTopic, invite, addInput, editInput, removeInput, transcribeAudio, loadVersionContent, suggestToc, saveToc, saveRights, inputs: sourceInputs, accessToken } = useTrustProject(String(projectId));
  const inputs = sourceInputs ?? [];
  const [rightsHolderDraft, setRightsHolderDraft] = useState(project?.project.rights_holder ?? "");
  const [rightsBusy, setRightsBusy] = useState(false);
  useEffect(() => {
    setRightsHolderDraft(project?.project.rights_holder ?? "");
  }, [project?.project.rights_holder]);

  const onToggleRights = () => {
    setRightsBusy(true);
    void (async () => {
      try {
        await saveRights(!project?.project.rights_attested_at, rightsHolderDraft.trim() || undefined);
      } catch (e) {
        Alert.alert("Couldn't save", e instanceof ApiError ? e.userMessage() : e instanceof Error ? e.message : "Please try again.");
      } finally {
        setRightsBusy(false);
      }
    })();
  };

  const onSaveRightsHolder = () => {
    setRightsBusy(true);
    void (async () => {
      try {
        await saveRights(!!project?.project.rights_attested_at, rightsHolderDraft.trim() || undefined);
      } catch (e) {
        Alert.alert("Couldn't save", e instanceof ApiError ? e.userMessage() : e instanceof Error ? e.message : "Please try again.");
      } finally {
        setRightsBusy(false);
      }
    })();
  };
  // Free/Pro plan status (T1/T4) — fetched once here (single source of truth)
  // and threaded down to Structure/Drafts (generation cap) and Publish
  // (export wall, T3). Client-side UX only — the server (T2) is the real
  // gate on every submit; plan:null (unknown — signed out, still loading, or
  // a failed billing fetch) must fail OPEN and never disable anything.
  const { plan } = useBillingPlan();
  const atGenerationCap = plan != null && !plan.is_pro && plan.at_generation_cap;
  // Same "fail open unless we KNOW the user is Free" guard useTrustProject's
  // other generators apply before going keyless (managed) — see
  // src/hooks/useTrustProject.ts. Computed locally here since the
  // Generate-full-book flow calls the trustClient methods directly (not
  // through useTrustProject) so Task 6's polling can own the job lifecycle.
  const knownNotPro = plan != null && plan.is_pro === false;
  const [inviteEmail, setInviteEmail] = useState("");
  // Task 4 (backend) added the editor role alongside reviewer; reviewer stays
  // the default since "invite an expert to review" is the common case.
  const [inviteRole, setInviteRole] = useState<"reviewer" | "editor">("reviewer");
  const [pubBusy, setPubBusy] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  // A MAP of in-flight formats to their progress, not a single busy format —
  // same "per-id busy, not a global lock" fix as topicGen below: a single
  // `genBusyFormat` string greyed EVERY whole-book card while one generated.
  // The value carries startedAt/phase (queued -> running) the same way
  // topicGen does, now that whole-book generation is a durable async job too.
  const [formatGen, setFormatGen] = useState<ReadonlyMap<string, GenProgress>>(new Map());
  // A MAP of in-flight topic ids to their progress, not a single id: the
  // Celery worker runs per-topic generations concurrently, and —
  // more importantly — a single `busyTopicId` string forced
  // `disabled={busyTopicId !== null}` to grey EVERY topic's Generate while
  // one ran (the "all Not-generated greyed, no option to generate" report).
  // Per-id busy gates each row independently; the value also carries the
  // startedAt/phase the per-row progress bar renders.
  const [topicGen, setTopicGen] = useState<ReadonlyMap<string, GenProgress>>(new Map());
  // Whole-book generate fan-out (ADR-037 book generation, T5): bookGenBusy
  // covers the estimate fetch AND the submit (there's no per-topic progress
  // to show here — Task 6 polls the durable generation_job row via the
  // job_id this stores and renders progress from that, not from this
  // button). Seam for Task 6: read/poll bookGenJobId.
  const [bookGenBusy, setBookGenBusy] = useState(false);
  const [bookGenJobId, setBookGenJobId] = useState<string | null>(null);
  // The generation_job row currently shown in DraftsPanel's whole-book
  // block (T6) — populated either by the active-job poll below or by the
  // on-focus latest-job fetch when there's no active local job.
  const [bookGenJob, setBookGenJob] = useState<GenerationJob | null>(null);
  const [sourceKind, setSourceKind] = useState<"transcript" | "note" | "link">("note");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceContent, setSourceContent] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [addSourceBusy, setAddSourceBusy] = useState(false);
  const [selected, setSelected] = useState<PhaseKey | null>(null);
  // Project-wide Revision-notes log (T2) — fetched only while the Feedback
  // phase is showing (see the effect below). Non-critical/read-only: a fetch
  // failure fails open to [] rather than surfacing an Alert or breaking the
  // panel.
  const [feedbackLog, setFeedbackLog] = useState<ProjectFeedbackItem[]>([]);
  const [desiredDraftMode, setDesiredDraftMode] = useState<"whole" | "topic">("whole");
  const [compareArtifactId, setCompareArtifactId] = useState<string | null>(null);
  const [compareSel, setCompareSel] = useState<string[]>([]);
  const [tocDraft, setTocDraft] = useState<StructuredTOC | null>(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  // Drives the Suggest-from-sources GenerateProgressBar — separate from
  // suggestBusy, which stays a re-entry guard + button-busy flag that also
  // spans the confirm-replace dialog (the bar itself clears well before
  // that, in onSuggest's `finally`).
  const [suggestGen, setSuggestGen] = useState<{ startedAt: number; phase: "queued" | "running" } | null>(null);
  const suggestElapsedMs = useElapsedMs(suggestGen?.startedAt ?? null);
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

  // Revision-notes log (T2): fetch project-wide feedback only while the
  // Feedback phase is showing and the user is signed in. Must sit above the
  // loading/error/!project early returns below (rules-of-hooks — same
  // constraint as the `selected`-seed effect above), so it re-derives the
  // active phase inline rather than reading the later `active` const. Fails
  // open on any rejection — this section is read-only/non-critical and must
  // never error the panel.
  useEffect(() => {
    if (!project || !accessToken) return;
    const isOwnerNow = project.my_role === "owner";
    const activeNow = selected ?? basePhase(deriveProjectPhase(project, isOwnerNow).currentKey);
    if (activeNow !== "validate") return;
    let cancelled = false;
    Promise.resolve()
      .then(() => listProjectFeedback(String(projectId), accessToken))
      .then((items) => {
        if (!cancelled) setFeedbackLog(items);
      })
      .catch(() => {
        if (!cancelled) setFeedbackLog([]);
      });
    return () => {
      cancelled = true;
    };
  }, [project, selected, accessToken, projectId]);

  // Whole-book generation progress (T6): once onGenerateBook stores a
  // job_id in bookGenJobId, poll the durable generation_job row (GET
  // /generation-jobs/{id}) — NOT the ephemeral Redis job status pollJob
  // targets, since this run can span well past a single request's
  // lifetime — at BOOK_GEN_POLL_MS. Stops itself at a terminal status
  // (done/halted/failed) rather than running forever, and a `done` job
  // triggers refresh() so the newly generated topic versions show. Fails
  // open on any fetch error: the progress surface just disappears rather
  // than showing a broken state.
  useEffect(() => {
    if (!bookGenJobId || !accessToken) return;
    let cancelled = false;
    const jobId = bookGenJobId;
    const poll = async () => {
      try {
        const job = await getGenerationJob(jobId, accessToken);
        if (cancelled) return;
        setBookGenJob(job);
        if (job.status === "done" || job.status === "halted" || job.status === "failed") {
          if (job.status === "done") void refresh();
          setBookGenJobId(null);
        }
      } catch {
        if (!cancelled) {
          setBookGenJob(null);
          setBookGenJobId(null);
        }
      }
    };
    void poll();
    const timer = setInterval(poll, BOOK_GEN_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [bookGenJobId, accessToken, refresh]);

  // On-return "ready" surface (T6): with no active local job (a fresh
  // mount, or the owner navigating back after leaving mid-run), fetch the
  // project's latest generation_job row on every focus and render its
  // status via the same BookGenSurface. Read-only/non-critical — fails
  // open to nothing (no surface, screen intact) on any fetch error.
  useFocusEffect(
    useCallback(() => {
      if (bookGenJobId || !accessToken) return;
      let cancelled = false;
      void latestGenerationJob(String(projectId), accessToken)
        .then((job) => {
          if (!cancelled) setBookGenJob(job);
        })
        .catch(() => {
          if (!cancelled) setBookGenJob(null);
        });
      return () => {
        cancelled = true;
      };
    }, [bookGenJobId, accessToken, projectId]),
  );

  if (loading && !project) return <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>;
  if (error) return <View style={styles.center}><Text style={styles.error}>{error}</Text></View>;
  if (!project) return null;

  const onInvite = async () => {
    const email = inviteEmail.trim();
    if (!email) return;
    setInviteBusy(true);
    try {
      await invite(email, inviteRole);
      setInviteEmail("");
      Alert.alert("Invited", `Invitation sent to ${email}.`);
    } catch (e) {
      Alert.alert("Couldn't invite", e instanceof ApiError ? e.userMessage() : "Please try again.");
    } finally {
      setInviteBusy(false);
    }
  };

  // Belt-and-suspenders (T4), mirroring onDownloadError below: the client-side
  // generation-cap wall (atGenerationCap) is UX only — if a Free-over-cap
  // request slips through anyway (stale/failed plan fetch, or a race with
  // another generation), the server (T2) still 402s the submit. Surface that
  // as an upgrade prompt distinct from a generic "Couldn't generate"/"Couldn't
  // suggest" failure. Returns true when it handled the error.
  const onGenerateCapError = (e: unknown): boolean => {
    if (e instanceof ApiError && e.status === 402) {
      Alert.alert("Upgrade to Pro", "You've reached the Free plan's generation limit. Upgrade to Pro to keep generating.");
      return true;
    }
    return false;
  };

  const onGenerateFormat = async (fmt: DraftFormat) => {
    setFormatGen((cur) => new Map(cur).set(fmt.format, { startedAt: Date.now(), phase: "queued" }));
    try {
      await generateFormat(fmt, {
        onPhase: (phase) => setFormatGen((cur) => {
          const p = cur.get(fmt.format);
          if (!p) return cur;
          const next = new Map(cur);
          next.set(fmt.format, { ...p, phase });
          return next;
        }),
      });
    } catch (e) {
      if (!onGenerateCapError(e)) {
        Alert.alert("Couldn't generate", e instanceof ApiError ? e.userMessage() : e instanceof Error ? e.message : "Try again.");
      }
    } finally {
      setFormatGen((cur) => {
        const next = new Map(cur);
        next.delete(fmt.format);
        return next;
      });
    }
  };

  const onOpenVersion = (artifactId: string, versionId: string) => {
    // A transcript artifact (audio capture) has no draft `sections` — the draft
    // version viewer would render it blank. Route it to the transcript review
    // surface instead, so a transcript is re-openable from the Drafts list (not
    // only right after upload).
    const fmt = project?.artifacts.find((a) => a.artifact.id === artifactId)?.artifact.format;
    if (fmt === "transcript") {
      router.push({
        pathname: "/trust/transcript/[artifactId]",
        params: { artifactId, versionId, projectId: String(projectId) },
      });
      return;
    }
    router.push({ pathname: "/trust/version/[versionId]", params: { versionId, artifactId, projectId: String(projectId) } });
  };

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
      if (!onGenerateCapError(e)) {
        Alert.alert("Couldn't generate", e instanceof ApiError ? e.userMessage() : e instanceof Error ? e.message : "Try again.");
      }
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

  // Whole-book generate fan-out (ADR-037 book generation, T5): a pre-run
  // estimate/confirm, then submit. Calls trustClient's estimateBook/generateBook
  // directly (not through useTrustProject — this is the only trust generator
  // whose progress lives in the durable generation_job row rather than the
  // ephemeral Redis job status the other generators poll via useGenerate*Job).
  // Key resolution mirrors generateFormat/generateTopic/suggestToc in
  // useTrustProject.ts exactly: loadApiKey, then the knownNotPro guard, then
  // apiKey: key ?? undefined so a Pro/unknown-plan user with no saved key still
  // goes keyless (managed) rather than being blocked client-side. The key is
  // resolved BEFORE the confirm message is built (not just before submit) —
  // the est_cost_micros_max `$` figure comes from OUR managed-plan pricing
  // table, which is meaningless (and misleading) for a BYOK submitter paying
  // their own vendor rate; a saved key gets a tokens-only message instead.
  const onGenerateBook = async () => {
    if (!accessToken) return;
    setBookGenBusy(true);
    let est;
    try {
      est = await estimateBook(String(projectId), accessToken);
    } catch (e) {
      Alert.alert("Couldn't estimate", e instanceof ApiError ? e.userMessage() : "Please try again.");
      setBookGenBusy(false);
      return;
    }

    const key = await loadApiKey("anthropic");
    const topicsWord = `${est.missing_topics} topic${est.missing_topics === 1 ? "" : "s"}`;
    const lines: string[] = [];
    if (key) {
      lines.push(`Generate ${topicsWord} — up to ~${est.est_output_tokens_max} tokens.`);
    } else {
      const dollars = (est.est_cost_micros_max / 1e6).toFixed(2);
      lines.push(`Generate ${topicsWord} — up to ~${est.est_output_tokens_max} tokens (~$${dollars} on your managed plan).`);
      if (est.would_exceed) {
        lines.push("This would exceed your remaining plan allowance.");
      }
    }
    lines.push("Proceed?");

    Alert.alert("Generate full book?", lines.join("\n\n"), [
      { text: "Cancel", style: "cancel", onPress: () => setBookGenBusy(false) },
      {
        text: "Generate",
        onPress: () => {
          void (async () => {
            try {
              if (!key && knownNotPro) {
                throw new Error("No API key saved. Add an Anthropic key in Settings to generate a draft.");
              }
              const job = await generateBook(String(projectId), accessToken, { apiKey: key ?? undefined });
              setBookGenJobId(job.job_id);
            } catch (e) {
              if (!onGenerateCapError(e)) {
                Alert.alert("Couldn't generate", e instanceof ApiError ? e.userMessage() : e instanceof Error ? e.message : "Try again.");
              }
            } finally {
              setBookGenBusy(false);
            }
          })();
        },
      },
    ]);
  };

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

  const onAddToLibrary = (versionId: string, _title: string, format: string) => {
    setPubBusy(`${versionId}:lib`);
    void (async () => {
      try {
        const v = await loadVersionContent(versionId);
        // Title = the project/work name (e.g. "Tholkapiam"), NOT the format label.
        // The format ("Long-form essay") becomes metadata; the real model comes
        // from the version's generation_meta (else it shows the default provider).
        const formatLabel = DRAFT_FORMATS.find((f) => f.format === format)?.label ?? format;
        const meta = { ...rightsMetadata(project.project), format: formatLabel };
        const book = artifactToBook(
          v.content?.sections ?? [],
          project.project.title,
          inputs,
          meta,
          provenanceFromMeta(v.generation_meta),
        );
        await saveBook(book); // Studio copy (kept)
        const { artifact: bytes } = await trackedExport(book, "epub", { diagrams: true });
        let coverBytes: ArrayBuffer | undefined;
        try {
          coverBytes = (await exportBook(book, { format: "cover" })).artifact;
        } catch {
          coverBytes = undefined;
        }
        await saveEpub({ bookId: book.id, title: book.title, bytes, coverBytes });
        Alert.alert("Added", "Added to your Library.");
      } catch (e) {
        if (e instanceof ApiError && e.status === 402) {
          onDownloadError(e);
          return;
        }
        Alert.alert("Couldn't add", e instanceof ApiError ? e.userMessage() : "Please try again.");
      } finally {
        setPubBusy(null);
      }
    })();
  };

  // Belt-and-suspenders: the client-side plan-status wall (PublishPanel) is UX
  // only — if a Free user's download slips through anyway (stale/failed plan
  // fetch), the server (T2) still 402s the export submit. Surface that as an
  // upgrade prompt, distinct from a generic download failure.
  const onDownloadError = (e: unknown) => {
    if (e instanceof ApiError && e.status === 402) {
      Alert.alert("Upgrade to Pro", "Downloading EPUB/PDF/Word is a Pro feature. Upgrade to Pro to download.");
      return;
    }
    Alert.alert("Couldn't download", e instanceof ApiError ? e.userMessage() : "Please try again.");
  };

  const onUpgrade = () => {
    router.push("/usage");
  };

  const onDownloadAsset = (versionId: string, _title: string, fmt: "epub" | "pdf" | "docx") => {
    setPubBusy(`${versionId}:${fmt}`);
    void (async () => {
      try {
        const v = await loadVersionContent(versionId);
        // Same fix as onAddToLibrary: the downloaded asset's title + filename use
        // the project/work name, not the format label; carry the real model.
        const book = artifactToBook(
          v.content?.sections ?? [],
          project.project.title,
          inputs,
          rightsMetadata(project.project),
          provenanceFromMeta(v.generation_meta),
        );
        const res = await trackedExport(book, fmt, { diagrams: true });
        await downloadArtifact(res.artifact, `${slug(project.project.title)}.${fmt}`, EXPORT_MIME[fmt]);
      } catch (e) {
        onDownloadError(e);
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
    return topicsToBook(project.project.title, toc, sectionsByTopic, inputs, rightsMetadata(project.project));
  };

  const onPublishToLibrary = () => {
    setPubBusy("book:lib");
    void (async () => {
      try {
        const book = await assembleBook();
        await saveBook(book); // Studio copy (kept)
        const { artifact: bytes } = await trackedExport(book, "epub", { diagrams: true });
        let coverBytes: ArrayBuffer | undefined;
        try {
          coverBytes = (await exportBook(book, { format: "cover" })).artifact;
        } catch {
          coverBytes = undefined;
        }
        await saveEpub({ bookId: book.id, title: book.title, bytes, coverBytes });
        Alert.alert("Added", "Added to your Library.");
      } catch (e) {
        if (e instanceof ApiError && e.status === 402) {
          onDownloadError(e);
          return;
        }
        Alert.alert("Couldn't add", e instanceof ApiError ? e.userMessage() : "Please try again.");
      } finally {
        setPubBusy(null);
      }
    })();
  };

  const onPublishDownload = (fmt: "epub" | "pdf" | "docx") => {
    setPubBusy(`book:${fmt}`);
    void (async () => {
      try {
        const book = await assembleBook();
        const res = await trackedExport(book, fmt, { diagrams: true });
        await downloadArtifact(
          res.artifact,
          `${slug(project.project.title)}.${fmt}`,
          EXPORT_MIME[fmt],
        );
      } catch (e) {
        onDownloadError(e);
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
    setSuggestGen({ startedAt: Date.now(), phase: "queued" });
    let suggested: StructuredTOC;
    try {
      suggested = tocViewToStructured(
        await suggestToc({ onPhase: (phase) => setSuggestGen((p) => (p ? { ...p, phase } : p)) }),
      );
    } catch (e) {
      if (!onGenerateCapError(e)) {
        Alert.alert("Couldn't suggest", e instanceof ApiError ? e.userMessage() : e instanceof Error ? e.message : "Try again.");
      }
      setSuggestBusy(false);
      return;
    } finally {
      // Cleared here (not in the outer flow) so the bar is gone before the
      // Replace? confirm dialog or the apply() below — it never shows
      // during either.
      setSuggestGen(null);
    }
    try {
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

  // Transcript artifacts (audio capture) with at least one version, surfaced on
  // the Input tab so a transcript is discoverable where the audio was uploaded
  // (not buried under Drafts → Whole book). Latest version by version_no.
  const transcripts = project.artifacts
    .filter((a) => a.artifact.format === "transcript" && a.versions.length > 0)
    .map((a) => {
      const latest = a.versions.reduce((m, v) => (v.version_no > m.version_no ? v : m), a.versions[0]);
      return {
        id: a.artifact.id,
        title: a.artifact.title ?? "Transcript",
        versionId: latest.id,
        versionNo: latest.version_no,
        validated: latest.is_validated,
      };
    });

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
        {/* Header row: Home link + the always-on engine/token chip. This screen is a
            pushed route OUTSIDE the tab chrome, so the nav's chip isn't here — but this
            is exactly where the user generates, so surface it inline. */}
        <View style={styles.projectHeaderRow}>
          <Pressable
            style={styles.homeLink}
            onPress={() => router.push("/")}
            accessibilityRole="button"
            accessibilityLabel="Back to Home"
          >
            <Text style={styles.homeLinkText}>‹ Home</Text>
          </Pressable>
          <EngineBadge />
        </View>
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
            onTranscribe={transcribeAudio}
            onTranscribed={(r) =>
              router.push({
                pathname: "/trust/transcript/[artifactId]",
                params: { artifactId: r.artifact_id, versionId: r.version_id, projectId: String(projectId) },
              })
            }
            transcripts={transcripts}
            onOpenTranscript={onOpenVersion}
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
            suggestGen={suggestGen}
            suggestElapsedMs={suggestElapsedMs}
            sourceLabel={sourceLabel}
            inputsEmpty={inputs.length === 0}
            atGenerationCap={atGenerationCap}
          />
        ) : null}
        {active === "create" ? (
          <DraftsPanel
            styles={styles}
            isOwner={isOwner}
            artifacts={project.artifacts}
            inputs={inputs}
            formatGen={formatGen}
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
            atGenerationCap={atGenerationCap}
            onGenerateBook={onGenerateBook}
            bookGenBusy={bookGenBusy}
            bookGenJob={bookGenJob}
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
            inviteRole={inviteRole}
            setInviteRole={setInviteRole}
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
            feedbackLog={feedbackLog}
          />
        ) : null}
        {active === "share" ? (
          <PublishPanel
            styles={styles}
            theme={theme}
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
            onUpgrade={onUpgrade}
            plan={plan}
            rightsAttestedAt={project.project.rights_attested_at}
            rightsHolderDraft={rightsHolderDraft}
            setRightsHolderDraft={setRightsHolderDraft}
            rightsBusy={rightsBusy}
            onToggleRights={onToggleRights}
            onSaveRightsHolder={onSaveRightsHolder}
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
  scroll: { flex: 1, backgroundColor: "transparent" },
  center: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, padding: spacing.xl },
  body: { padding: spacing.md, gap: spacing.md },
  // Fraunces bakes the weight into the family name, so no fontWeight here (a
  // redundant fontWeight would synth faux-bold on web — see applyGlobalFont).
  // letterSpacing = -0.02em × fontSize (export §4 heading tracking).
  projectHeaderRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  homeLink: { alignSelf: "flex-start" as const, paddingVertical: spacing.xs },
  homeLinkText: { color: c.primary, fontSize: typography.sizeSm, fontWeight: "600" as const },
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
  // Same sizing as genHint, but the error token — the job-level `failed`
  // surface in BookGenSurface (final-review Finding A).
  genError: { color: c.error, fontSize: typography.sizeXs },
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
  captureCard: { gap: spacing.xs, borderColor: c.border },
  captureCardTitle: { color: c.text, fontSize: typography.sizeMd, fontWeight: "700" as const },
  captureCardHelper: { color: c.textSecondary, fontSize: typography.sizeSm },
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
  // Project-wide Revision-notes log (T2) — a top divider (not a full
  // border) sets it apart from the whole/topic review content above without
  // reading as a second, separately-bordered panel.
  revisionSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: c.border,
    gap: spacing.sm,
  },
  revisionRow: { gap: spacing.xs },
  revisionBody: { color: c.text, fontSize: typography.sizeSm },
  revisionMeta: { color: c.textMuted, fontSize: typography.sizeXs },
});
