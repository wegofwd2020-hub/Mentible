import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { PhaseTabBar } from "@/components/PhaseTabBar";
import { Alert } from "@/lib/alert";
import { useTrustProject } from "@/hooks/useTrustProject";
import { ApiError } from "@/api/client";
import type { ArtifactDetailView, ProjectInputView } from "@/api/trustClient";
import { deriveProjectPhase, type PhaseKey } from "@/lib/projectPhase";
import { DRAFT_FORMATS, type DraftFormat } from "@/constants/draftFormats";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import { SmeThemeScope, useTheme, useThemedStyles } from "@/theme";

type Styles = ReturnType<typeof makeStyles>;
type ThemeShape = ReturnType<typeof useTheme>;

const SOURCE_KINDS: { value: "transcript" | "note" | "link"; label: string }[] = [
  { value: "transcript", label: "Transcript" },
  { value: "note", label: "Note" },
  { value: "link", label: "Link" },
];

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
// Reviewers see the list only — capture is an owner action.
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
}) {
  return (
    <View style={styles.sourcesBlock}>
      <Text style={styles.artifactTitle}>Sources</Text>
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
        inputs.map((input) => (
          <View key={input.id} style={styles.sourceRow}>
            <Text style={styles.sourceKindLabel}>{sourceKindLabel(input.kind)}</Text>
            <Text style={styles.sourceRowTitle}>{sourcePreview(input.title, input.content)}</Text>
            {sourceDate(input.created_at) ? <Text style={styles.sourceRowDate}>{sourceDate(input.created_at)}</Text> : null}
          </View>
        ))
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
}: {
  styles: Styles;
  isOwner: boolean;
  artifacts: ArtifactDetailView[];
  inputs: ProjectInputView[];
  genBusyFormat: string | null;
  onGenerateFormat: (fmt: DraftFormat) => void;
  onOpenVersion: (artifactId: string, versionId: string) => void;
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
        artifacts.map(({ artifact, versions }) => (
          <View key={artifact.id} style={styles.artifact}>
            <Text style={styles.artifactTitle}>{artifact.title ?? artifact.format}</Text>
            {versions.length === 0 ? (
              <Text style={styles.emptyText}>No drafts yet.</Text>
            ) : (
              versions.map((v) => (
                <Pressable
                  key={v.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open version ${v.version_no}`}
                  style={styles.versionRow}
                  onPress={() => onOpenVersion(artifact.id, v.id)}
                >
                  <Text style={styles.versionLabel}>v{v.version_no}</Text>
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
                </Pressable>
              ))
            )}
          </View>
        ))
      )}
    </View>
  );
}

// Feedback (validate phase): the Approve flow for unvalidated versions + the
// validated/recorded_via display, plus (owner) the Invite-an-expert control.
// Nothing to review until a draft exists, so this stays gated on anyVersion.
function FeedbackPanel({
  styles,
  theme,
  isOwner,
  artifacts,
  anyVersion,
  busy,
  onApprove,
  inviteEmail,
  setInviteEmail,
  inviteBusy,
  onInvite,
  onOpenVersion,
}: {
  styles: Styles;
  theme: ThemeShape;
  isOwner: boolean;
  artifacts: ArtifactDetailView[];
  anyVersion: boolean;
  busy: string | null;
  onApprove: (versionId: string, versionNo: number) => void;
  inviteEmail: string;
  setInviteEmail: (v: string) => void;
  inviteBusy: boolean;
  onInvite: () => void;
  onOpenVersion: (artifactId: string, versionId: string) => void;
}) {
  if (!anyVersion) {
    return <Text style={styles.emptyText}>Finish Drafts first — generate a draft before it can be reviewed.</Text>;
  }
  return (
    <View style={styles.artifactsWrap}>
      {artifacts.map(({ artifact, versions }) => (
        <View key={artifact.id} style={styles.artifact}>
          <Text style={styles.artifactTitle}>{artifact.title ?? artifact.format}</Text>
          {versions.map((v) => (
            <View key={v.id} style={styles.versionRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open version ${v.version_no}`}
                onPress={() => onOpenVersion(artifact.id, v.id)}
              >
                <Text style={styles.versionLabel}>v{v.version_no}</Text>
              </Pressable>
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
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Approve version ${v.version_no}`}
                  disabled={busy === v.id}
                  style={styles.approveBtn}
                  onPress={() => onApprove(v.id, v.version_no)}
                >
                  <Text style={styles.approveText}>{busy === v.id ? "…" : "Approve"}</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      ))}
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

// Publish (share phase): deferred (user decision) — placeholder only, no CTA.
function PublishPanel({ styles }: { styles: Styles }) {
  return (
    <View style={styles.artifactsWrap}>
      <Text style={styles.emptyText}>Sharing & export are coming soon.</Text>
    </View>
  );
}

function TrustProjectDetailInner() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { project, loading, error, approve, generateFormat, invite, addInput, inputs: sourceInputs } = useTrustProject(String(projectId));
  const inputs = sourceInputs ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [genBusyFormat, setGenBusyFormat] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<"transcript" | "note" | "link">("note");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceContent, setSourceContent] = useState("");
  const [addSourceBusy, setAddSourceBusy] = useState(false);
  const [selected, setSelected] = useState<PhaseKey | null>(null);

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

  if (loading && !project) return <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>;
  if (error) return <View style={styles.center}><Text style={styles.error}>{error}</Text></View>;
  if (!project) return null;

  const onApprove = (versionId: string, versionNo: number) => {
    Alert.alert(
      "Record approval",
      `Record your approval of v${versionNo}? It is logged as expert-validated by you.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Approve",
          onPress: async () => {
            setBusy(versionId);
            try {
              const ap = await approve(versionId);
              Alert.alert("Approved", ap.recorded_via === "expert_self" ? "Recorded as expert-validated." : "Approval recorded.");
            } catch (e) {
              Alert.alert("Couldn't approve", e instanceof ApiError ? e.userMessage() : "Please try again.");
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  };

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
          />
        ) : null}
        {active === "validate" ? (
          <FeedbackPanel
            styles={styles}
            theme={theme}
            isOwner={isOwner}
            artifacts={project.artifacts}
            anyVersion={anyVersion}
            busy={busy}
            onApprove={onApprove}
            inviteEmail={inviteEmail}
            setInviteEmail={setInviteEmail}
            inviteBusy={inviteBusy}
            onInvite={onInvite}
            onOpenVersion={onOpenVersion}
          />
        ) : null}
        {active === "share" ? <PublishPanel styles={styles} /> : null}
      </PageContainer>
    </ScrollView>
  );
}

export default function TrustProjectDetail() {
  // SME surface → always Navy Trust (ADR-038). Scope wraps the content so
  // TrustProjectDetailInner's useThemedStyles resolves navy-trust.
  return (
    <SmeThemeScope>
      <TrustProjectDetailInner />
    </SmeThemeScope>
  );
}

const makeStyles = (c: Palette) => ({
  scroll: { flex: 1 },
  center: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, padding: spacing.xl },
  body: { padding: spacing.md, gap: spacing.md },
  // Fraunces bakes the weight into the family name, so no fontWeight here (a
  // redundant fontWeight would synth faux-bold on web — see applyGlobalFont).
  // letterSpacing = -0.02em × fontSize (export §4 heading tracking).
  title: { color: c.text, fontSize: typography.sizeXxl, fontFamily: FRAUNCES.bold, letterSpacing: -0.56 },
  topic: { color: c.textSecondary, fontSize: typography.sizeMd },
  artifact: { backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md, gap: spacing.sm },
  artifactTitle: { color: c.text, fontSize: typography.sizeLg, fontFamily: FRAUNCES.semibold, letterSpacing: -0.36 },
  versionRow: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
  versionLabel: { color: c.textSecondary, fontSize: typography.sizeMd },
  validatedRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs },
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
  artifactsWrap: { gap: spacing.md },
});
