import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { useAuth } from "@/auth/AuthProvider";
import { addFeedback, getVersion, runGroundingCheck, runOriginalityCheck, type VersionDetailView } from "@/api/trustClient";
import { useTrustProject } from "@/hooks/useTrustProject";
import { ApiError } from "@/api/client";
import { pollJob } from "@/api/pollJob";
import { copyText } from "@/lib/clipboard";
import { sectionsToPlainText } from "@/lib/draftExport";
import { describeProvenance } from "@/lib/draftProvenance";
import { diffVersions } from "@/lib/diffVersions";
import { Alert } from "@/lib/alert";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import { useTheme, useThemedStyles } from "@/theme";
import { TopicRenderer } from "@/components/LessonRenderer";
import { versionToTopic } from "@/lib/topicVersionToTopic";
import { GenerateProgressBar } from "@/components/GenerateProgressBar";
import { useElapsedMs } from "@/hooks/useElapsedMs";
import { QualityCard } from "@/components/QualityCard";
import { loadApiKey } from "@/secure/keyStore";

type Styles = ReturnType<typeof makeStyles>;
type GenProgress = { startedAt: number; phase: "queued" | "running" };

const DIFF_GLYPH: Record<"added" | "removed" | "changed" | "unchanged", string> = {
  added: "+", removed: "−", changed: "~", unchanged: "·",
};

function TrustVersionInner() {
  const { versionId, artifactId, projectId } = useLocalSearchParams<{
    versionId: string; artifactId: string; projectId: string;
  }>();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { accessToken } = useAuth();
  // knownNotPro: the same fail-open Pro-gate generateVersion/generateFormat
  // use internally (null/loading plan never walls — the backend decides;
  // only a KNOWN Free plan does) — exposed by the hook so onRunGrounding
  // below can reuse it without a second, unmocked useBillingPlan() call.
  const { project, addVersion, generateVersion, approve, unapprove, knownNotPro } = useTrustProject(String(projectId));
  const [version, setVersion] = useState<VersionDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ heading: string; body: string; source_ids: string[] }[]>([]);
  const [saving, setSaving] = useState(false);
  const [regen, setRegen] = useState(false);
  const [guidance, setGuidance] = useState("");
  const [reviseGen, setReviseGen] = useState<GenProgress | null>(null);
  const reviseElapsed = useElapsedMs(reviseGen?.startedAt ?? null);
  const [apBusy, setApBusy] = useState(false);
  const [askName, setAskName] = useState(false);
  const [expertName, setExpertName] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [openCommentIndex, setOpenCommentIndex] = useState<number | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [prevVersion, setPrevVersion] = useState<VersionDetailView | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [grBusy, setGrBusy] = useState(false);
  const [orBusy, setOrBusy] = useState(false);
  // Task 4 (backend, this branch) added the editor role: edit/create-version
  // endpoints allow owner+editor, approve/withdraw allow owner+reviewer.
  // canEdit/canApprove mirror that matrix here so the controls a role can't
  // use never render (rather than rendering and failing the API call).
  const role = project?.my_role;
  const isOwner = role === "owner";
  const canEdit = role === "owner" || role === "editor";
  const canApprove = role === "owner" || role === "reviewer";

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
    // Navigating to a different version (e.g. via the Versions block below)
    // invalidates any fetched "changes from" comparison — collapse it rather
    // than showing a diff against the wrong pair.
    setDiffOpen(false);
    setPrevVersion(null);
    return () => { live = false; };
  }, [accessToken, versionId]);

  // input id -> "S1".."Sn", mirroring the backend's label mapping (inputs order).
  const labelFor = useMemo(() => {
    const m = new Map<string, string>();
    (project?.inputs ?? []).forEach((inp, i) => m.set(inp.id, `S${i + 1}`));
    return m;
  }, [project]);

  // Per-section index -> short quality notes ("uncited", "dangling source",
  // "unsupported claims"), derived from `version.quality` (T2/T4). Feeds the
  // small annotation next to each section in the "Section comments" list
  // below — the only per-section anchor this screen has, since the reader
  // above renders every section merged into one doc.
  const sectionNotes = useMemo(() => {
    const q = version?.quality;
    const m = new Map<number, string[]>();
    if (!q) return m;
    const add = (i: number, note: string) => m.set(i, [...(m.get(i) ?? []), note]);
    q.coverage.uncited_section_indexes.forEach((i) => add(i, "uncited"));
    q.coverage.dangling.forEach((d) => add(d.section_index, "dangling source"));
    q.grounding?.by_section.forEach((s) => {
      if (s.claims.some((c) => c.status === "unsupported")) add(s.section_index, "unsupported claims");
    });
    return m;
  }, [version]);

  // Owner-only: submits the on-demand grounding check (billable LLM pass —
  // ADR docs), polls the shared /jobs/{id} until done|failed, then refetches
  // this version so `quality.grounding` reflects the fresh result. Mirrors
  // doRegen's submit-then-poll-then-reload shape, using the same
  // `loadApiKey("anthropic")` BYOK-or-managed key resolution generateVersion
  // (useTrustProject) uses — including its `knownNotPro` pre-gate, so a KNOWN
  // Free user with no saved key gets the same friendly message immediately
  // instead of a 402 round-trip.
  const onRunGrounding = () => {
    if (!accessToken) return;
    setGrBusy(true);
    void (async () => {
      try {
        const key = await loadApiKey("anthropic");
        if (!key && knownNotPro) throw new Error("No API key saved. Add an Anthropic key in Settings to run a grounding check.");
        const submitted = await runGroundingCheck(String(versionId), { api_key: key ?? undefined, provider_id: "anthropic" }, accessToken);
        await pollJob(submitted.job_id, accessToken, {
          intervalMs: 3_000,
          timeoutMessage: "Timed out waiting for the grounding check",
          failedMessage: "Grounding check failed",
        });
        await reloadVersion().catch(() => {});
      } catch (e) {
        Alert.alert("Couldn't run grounding check", e instanceof ApiError ? e.userMessage() : e instanceof Error ? e.message : "Please try again.");
      } finally {
        setGrBusy(false);
      }
    })();
  };

  // Owner-only: submits the on-demand originality/source-overlap check
  // (billable LLM pass) — checks the draft against ITS OWN cited sources
  // only, never the web. Byte-for-byte mirror of onRunGrounding above.
  const onRunOriginality = () => {
    if (!accessToken) return;
    setOrBusy(true);
    void (async () => {
      try {
        const key = await loadApiKey("anthropic");
        if (!key && knownNotPro) throw new Error("No API key saved. Add an Anthropic key in Settings to run an originality check.");
        const submitted = await runOriginalityCheck(String(versionId), { api_key: key ?? undefined, provider_id: "anthropic" }, accessToken);
        await pollJob(submitted.job_id, accessToken, {
          intervalMs: 3_000,
          timeoutMessage: "Timed out waiting for the originality check",
          failedMessage: "Originality check failed",
        });
        await reloadVersion().catch(() => {});
      } catch (e) {
        Alert.alert("Couldn't run originality check", e instanceof ApiError ? e.userMessage() : e instanceof Error ? e.message : "Please try again.");
      } finally {
        setOrBusy(false);
      }
    })();
  };

  // Sibling versions of this same artifact, for the inline "Versions" history
  // block. Defensive: no matching artifact (still loading, or a bad id) just
  // yields an empty list — the block itself renders nothing below.
  const versions = useMemo(
    () => (project?.artifacts ?? []).find((a) => a.artifact.id === artifactId)?.versions ?? [],
    [project, artifactId],
  );

  // The immediately-prior version of this same artifact, for "Changes from
  // v(n-1)". Looked up by version_no (not array position) — `versions` isn't
  // guaranteed sorted — and undefined for v1 or when the sibling list hasn't
  // loaded yet, which hides the toggle below.
  const prevVersionSummary = useMemo(
    () => (version ? versions.find((v) => v.version_no === version.version_no - 1) : undefined),
    [versions, version],
  );

  // The web view-mode render preview: built ONCE per version (not inline in
  // JSX). Building it fresh on every render (approve/withdraw reload, theme,
  // busy state) would hand TopicRenderer a new object each time, re-running
  // the reader's html memo and wiping any diagram the enhance pass had just
  // drawn (the topic viewer's "diagram flashes then reverts" bug — see
  // trust/topic-version/[id].tsx's builtTopic comment).
  // Guard on `content?.sections` (not just `version`): a malformed version can
  // arrive with no `sections` at all, and `versionToTopic` maps it verbatim —
  // it would throw reading `.sections.map` off `undefined`. Falling back to
  // `null` here mirrors the native branch's `version.content?.sections ?? []`
  // defend-on-read for the same shape.
  const previewTopic = useMemo(
    () => (version?.content?.sections ? versionToTopic(version) : null),
    [version],
  );
  // Section-level source chips are lost once the sections flow through the
  // reader as one lesson body, so the web preview shows one aggregate row of
  // every source cited anywhere in the draft instead.
  const previewSources = useMemo(
    () => Array.from(new Set((version?.content?.sections ?? []).flatMap((s) => s.source_ids ?? []))),
    [version],
  );

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
        "Revise a validated draft?",
        `This creates a new version. The approval on v${version!.version_no} stays; the new version will need re-approval.`,
        [{ text: "Cancel", style: "cancel" }, { text: "Revise", onPress: go }],
      );
    } else { go(); }
  };

  const doRegen = async () => {
    setReviseGen({ startedAt: Date.now(), phase: "queued" });
    try {
      const v = await generateVersion(String(artifactId), {
        guidance: guidance.trim() || undefined,
        onPhase: (phase) => setReviseGen((p) => (p ? { ...p, phase } : p)),
      });
      router.push({ pathname: "/trust/version/[versionId]", params: { versionId: v.id, artifactId: String(artifactId), projectId: String(projectId) } });
      setRegen(false); setGuidance("");
    } catch (e) {
      Alert.alert("Couldn't regenerate", e instanceof ApiError ? e.userMessage() : e instanceof Error ? e.message : "Try again.");
    } finally { setReviseGen(null); }
  };

  const onCopy = async () => {
    const text = sectionsToPlainText(version!.content?.sections);
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

  // Single handler taking the index (rather than N per-index closures) — a
  // fresh `() => toggle(i)` per Pressable is cheap and matches the pattern
  // already used for `removeSection`/note actions elsewhere in this file;
  // what must stay stable is `previewTopic`, which this doesn't touch.
  const toggleComment = useCallback((i: number) => {
    setOpenCommentIndex((prev) => (prev === i ? null : i));
    setCommentDraft("");
  }, []);

  // Collapsed by default; fetches the previous version's content lazily on
  // first open (not on every render) and memoizes it, since re-fetching each
  // time the toggle is opened/closed would be wasteful and would flash the
  // diff away and back.
  const toggleDiff = useCallback(() => {
    setDiffOpen((prev) => {
      const next = !prev;
      if (next && !prevVersion && prevVersionSummary && accessToken) {
        setDiffLoading(true);
        void (async () => {
          try {
            const v = await getVersion(prevVersionSummary.id, accessToken);
            setPrevVersion(v);
          } catch {
            // Best-effort: leave prevVersion null; the diff section below
            // just stays empty rather than surfacing a hard error for a
            // secondary, opt-in affordance.
          } finally {
            setDiffLoading(false);
          }
        })();
      }
      return next;
    });
  }, [prevVersion, prevVersionSummary, accessToken]);

  const sectionDiff = useMemo(
    () => (prevVersion && version ? diffVersions(prevVersion.content?.sections ?? [], version.content?.sections ?? []) : []),
    [prevVersion, version],
  );

  const submitSectionComment = useCallback((i: number) => {
    const text = commentDraft.trim();
    if (!text || !accessToken) return;
    setCommentBusy(true);
    void (async () => {
      try {
        await addFeedback(String(versionId), { body: text, section_index: i }, accessToken);
        setCommentDraft("");
        setOpenCommentIndex(null);
        await reloadVersion().catch(() => {});
      } catch (e) {
        Alert.alert("Couldn't send", e instanceof ApiError ? e.userMessage() : "Please try again.");
      } finally {
        setCommentBusy(false);
      }
    })();
  }, [accessToken, versionId, commentDraft, reloadVersion]);

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
          <View>
            <Text style={styles.title}>v{version.version_no}</Text>
            <Text style={styles.provenance}>{describeProvenance(version.generation_meta)}</Text>
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
        <QualityCard quality={version.quality} isOwner={isOwner} busy={grBusy} onRunGrounding={onRunGrounding} origBusy={orBusy} onRunOriginality={onRunOriginality} />
        {!editing ? (
          <View style={styles.actionsRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Copy draft" style={styles.editBtn} onPress={onCopy}>
              <Text style={styles.editBtnText}>Copy</Text>
            </Pressable>
            {isOwner ? (
              // Revise hits generate_version (billable LLM-regen), which
              // Task 4 kept owner-only on the backend — unlike create_version
              // (manual "Edit text" save below), it was NOT opened to editor.
              // Gating this on canEdit would let an editor tap Revise and 403.
              <Pressable accessibilityRole="button" accessibilityLabel="Revise draft" style={styles.editBtn} onPress={openRegen}>
                <Text style={styles.editBtnText}>Revise</Text>
              </Pressable>
            ) : null}
            {canEdit ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Edit draft" style={styles.editBtn} onPress={startEdit}>
                <Text style={styles.editBtnText}>Edit text</Text>
              </Pressable>
            ) : null}
            {canApprove ? (
              version.is_validated ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Withdraw approval of version ${version.version_no}`} disabled={apBusy} style={styles.unapproveBtn} onPress={onUnapprove}>
                  <Text style={styles.unapproveText}>{apBusy ? "…" : "Unapprove"}</Text>
                </Pressable>
              ) : (
                <Pressable accessibilityRole="button" accessibilityLabel={`Approve version ${version.version_no}`} disabled={apBusy} style={styles.approveBtn} onPress={onApprove}>
                  <Text style={styles.approveText}>{apBusy ? "…" : "Approve"}</Text>
                </Pressable>
              )
            ) : null}
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
            <Text style={styles.bodyText}>Revise — describe the change; this creates a new version.</Text>
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
              disabled={reviseGen !== null}
              onPress={doRegen}
            >
              <Text style={styles.saveBtnText}>{reviseGen !== null ? "Generating…" : "Generate new version"}</Text>
            </Pressable>
            {reviseGen ? <GenerateProgressBar phase={reviseGen.phase} elapsedMs={reviseElapsed} /> : null}
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
          // View mode: render the draft through the ONE reader (web = real DOM,
          // native = auto-height WebView) so diagrams/mermaid/Markdown draw in-app
          // on BOTH surfaces. Per-section source chips collapse to one aggregate
          // row (the reader renders the draft as a single doc).
          <>
            {previewTopic ? <TopicRenderer topic={previewTopic} inline /> : null}
            {previewSources.length > 0 ? (
              <View style={styles.citeRow}>
                {previewSources.map((id) => (
                  <Text key={id} style={styles.cite}>{labelFor.get(id) ?? "cited"}</Text>
                ))}
              </View>
            ) : null}
            {/* Section-level diff against the immediately-prior version, on
                request — hidden entirely for v1 / when no sibling artifact
                version data has loaded yet (prevVersionSummary undefined). */}
            {prevVersionSummary ? (
              <View style={styles.notesBlock}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Changes from v${prevVersionSummary.version_no}`}
                  onPress={toggleDiff}
                >
                  <Text style={styles.notesTitle}>
                    {diffOpen ? "▾" : "▸"} Changes from v{prevVersionSummary.version_no}
                  </Text>
                </Pressable>
                {diffOpen ? (
                  diffLoading && !prevVersion ? (
                    <ActivityIndicator color={theme.primary} />
                  ) : (
                    sectionDiff.map((d, i) => (
                      <Text key={`${d.heading}-${i}`} style={styles.bodyText}>
                        {DIFF_GLYPH[d.status]} {d.heading}
                      </Text>
                    ))
                  )
                ) : null}
              </View>
            ) : null}
            {/* Per-section comment affordances. The reader above renders every
                section as one merged doc, so there's no in-reader anchor to hang
                a comment control on — this thin list, keyed to
                `version.content.sections`, is the anchor instead. */}
            {(version.content?.sections ?? []).length > 0 ? (
              <View style={styles.notesBlock}>
                <Text style={styles.notesTitle}>Section comments</Text>
                {(version.content?.sections ?? []).map((s, i) => {
                  const sectionFeedback = (version.feedback ?? []).filter((f) => f.section_index === i);
                  return (
                    <View key={i} style={styles.noteRow}>
                      {/* "Section N: <heading>" (never bare `s.heading`) — the
                          reader above already renders that exact heading text
                          once; duplicating it verbatim here would make it
                          ambiguous which node a `getByText(heading)` query hit. */}
                      <Text style={styles.noteMeta}>{`Section ${i + 1}: ${s.heading}`}</Text>
                      {(sectionNotes.get(i) ?? []).length > 0 ? (
                        <Text style={styles.sectionQualityNote}>{(sectionNotes.get(i) ?? []).join(" · ")}</Text>
                      ) : null}
                      {sectionFeedback.map((f) => (
                        <View key={f.id} style={styles.sectionCommentRow}>
                          <Text style={styles.noteMeta}>
                            {f.author_name ?? (f.author_kind === "expert" ? "Expert" : "Owner")}
                            {f.created_at ? ` · ${new Date(f.created_at).toLocaleDateString()}` : ""}
                          </Text>
                          <Text style={styles.noteBody}>{f.body}</Text>
                        </View>
                      ))}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Comment on section ${i + 1}`}
                        style={styles.editBtn}
                        onPress={() => toggleComment(i)}
                      >
                        <Text style={styles.editBtnText}>{openCommentIndex === i ? "Cancel" : "Comment"}</Text>
                      </Pressable>
                      {openCommentIndex === i ? (
                        <>
                          <TextInput
                            style={[styles.input, styles.bodyInput]}
                            value={commentDraft}
                            onChangeText={setCommentDraft}
                            accessibilityLabel={`Comment on section ${i + 1} body`}
                            placeholder="Add a comment…"
                            maxLength={1000}
                            multiline
                          />
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Submit comment on section ${i + 1}`}
                            style={[styles.saveBtn, !commentDraft.trim() ? styles.disabledBtn : null]}
                            disabled={commentBusy || !commentDraft.trim()}
                            onPress={() => submitSectionComment(i)}
                          >
                            <Text style={styles.saveBtnText}>{commentBusy ? "Sending…" : "Submit comment"}</Text>
                          </Pressable>
                        </>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ) : null}
          </>
        )}
        {!editing ? (
          <View style={styles.notesBlock}>
            <Text style={styles.notesTitle}>Revision notes</Text>
            {!isOwner ? (
              <Text style={styles.notesEmpty}>Leaves a note for the owner — they&apos;ll revise the draft.</Text>
            ) : null}
            {(version.feedback ?? []).filter((f) => f.section_index == null).length === 0 ? (
              <Text style={styles.notesEmpty}>
                {isOwner ? "No revision notes yet." : "No revision notes yet. Ask for a change below."}
              </Text>
            ) : (
              (version.feedback ?? []).filter((f) => f.section_index == null).map((f) => (
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
              </>
            ) : null}
          </View>
        ) : null}
        {!editing && versions.length > 1 ? (
          <View style={styles.notesBlock}>
            <Text style={styles.notesTitle}>Versions</Text>
            {versions.map((v) => {
              const isCurrent = v.id === versionId;
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
                  onPress={() => router.push({ pathname: "/trust/version/[versionId]", params: { versionId: v.id, artifactId: String(artifactId), projectId: String(projectId) } })}
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
    </ScrollView>
  );
}

export default function TrustVersion() {
  // Follows the user's selected theme (ADR-038 O1 reversed).
  return <TrustVersionInner />;
}

const makeStyles = (c: Palette) => ({
  scroll: { flex: 1 as const, backgroundColor: "transparent" },
  body: { padding: spacing.md, gap: spacing.md },
  center: { flex: 1 as const, alignItems: "center" as const, justifyContent: "center" as const, padding: spacing.xl },
  headerRow: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
  title: { color: c.text, fontSize: typography.sizeXxl, fontFamily: FRAUNCES.bold, letterSpacing: -0.56 },
  provenance: { color: c.textMuted, fontSize: typography.sizeSm, marginTop: 2 },
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
  sectionCommentRow: { gap: 2, paddingBottom: spacing.xs },
  versionRowInner: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, gap: spacing.sm },
  noteMeta: { color: c.textMuted, fontSize: typography.sizeXs, fontWeight: "700" as const },
  noteBody: { color: c.text, fontSize: typography.sizeSm, lineHeight: 20 as const },
  reviseFromNoteBtn: { alignSelf: "flex-start" as const, paddingVertical: spacing.xs },
  reviseFromNoteText: { color: c.primary, fontSize: typography.sizeSm },
  sectionQualityNote: { color: c.error, fontSize: typography.sizeXs },
});
