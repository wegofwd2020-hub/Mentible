import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { RequireSignIn } from "@/auth/RequireSignIn";
import { Alert } from "@/lib/alert";
import { useOwnedProjects } from "@/hooks/useOwnedProjects";
import { useBillingPlan } from "@/hooks/useBillingPlan";
import { useResponsive } from "@/hooks/useResponsive";
import { ApiError } from "@/api/client";
import { FRAUNCES } from "@/constants/fonts";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";
import { Button, Label } from "@/components/ui";

function NewProjectInner() {
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { create } = useOwnedProjects();
  const { isTablet } = useResponsive();
  // Free/Pro new-project cap (T4) — UX only, fails open. plan:null (unknown —
  // signed out, still loading, or a failed billing fetch) must never disable
  // Create; the server (T2) is the real gate and 402s on POST /projects.
  const { plan } = useBillingPlan();
  const atProjectCap = plan != null && !plan.is_pro && plan.at_project_cap;
  const [title, setTitle] = useState(""); const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState(""); const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const goBack = () => (router.canGoBack?.() ? router.back() : router.replace("/projects"));
  const submit = async () => {
    if (!title.trim()) { Alert.alert("Title required", "Give the project a title."); return; }
    setBusy(true);
    try {
      const p = await create({ title: title.trim(), topic: topic.trim() || undefined, audience: audience.trim() || undefined, goal: goal.trim() || undefined });
      router.replace(`/trust/${p.id}`);
    } catch (e) {
      // Belt-and-suspenders: the atProjectCap wall above is UX only — if a
      // Free-over-cap create slips through anyway (stale/failed plan fetch),
      // the server (T2) still 402s. Surface that as an upgrade prompt,
      // distinct from a generic "Couldn't create" failure.
      if (e instanceof ApiError && e.status === 402) {
        Alert.alert("Upgrade to Pro", "You've reached the Free plan's project limit. Upgrade to Pro to start another project.");
      } else {
        Alert.alert("Couldn't create", e instanceof ApiError ? e.userMessage() : "Please try again.");
      }
    }
    finally { setBusy(false); }
  };
  const field = (
    label: string,
    v: string,
    set: (s: string) => void,
    placeholder: string,
    opts?: { multiline?: boolean; required?: boolean; maxLength?: number },
  ) => (
    <View style={styles.field}>
      <Label tone="secondary">
        {label}
        {opts?.required ? <Text style={styles.required}> *</Text> : null}
      </Label>
      <TextInput
        value={v}
        onChangeText={set}
        style={opts?.multiline ? [styles.input, styles.inputMultiline] : styles.input}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        accessibilityLabel={label}
        multiline={opts?.multiline}
        textAlignVertical={opts?.multiline ? "top" : undefined}
        maxLength={opts?.maxLength}
      />
    </View>
  );
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.body}><PageContainer>
      <View style={styles.content}>
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Back to projects"
          style={styles.backLink}
        >
          <Text style={styles.backLinkText}>← Back to projects</Text>
        </Pressable>
        <Text style={styles.heading}>New project</Text>
        <Text style={styles.subhead}>Give your studio a topic to work on. You can refine any of this later.</Text>
        {field("Title", title, setTitle, "Post-mortems that change engineering culture", { required: true, maxLength: 120 })}
        {field("Topic", topic, setTopic, "The specific insight or angle you want to develop", { multiline: true, maxLength: 500 })}
        <View style={isTablet ? styles.row : styles.col} testID="audienceGoalRow">
          <View style={isTablet ? styles.rowItem : undefined}>
            {field("Audience", audience, setAudience, "Senior engineering leaders")}
          </View>
          <View style={isTablet ? styles.rowItem : undefined}>
            {field("Goal", goal, setGoal, "Teach · Thought leadership · Lead-gen")}
          </View>
        </View>
        <Button
          variant="primary"
          label="Create project"
          onPress={submit}
          busy={busy}
          disabled={atProjectCap}
          accessibilityLabel="Create project"
          style={styles.submitBtn}
        />
        {atProjectCap ? <Text style={styles.capHint}>Free limit reached — upgrade to Pro</Text> : null}
      </View>
    </PageContainer></ScrollView>
  );
}

export default function NewProjectScreen() {
  // Follows the user's selected theme (ADR-038 O1 reversed).
  return (
    <RequireSignIn action="start a project">
      <NewProjectInner />
    </RequireSignIn>
  );
}
const makeStyles = (c: Palette) => ({
  scroll: { flex: 1, backgroundColor: "transparent" }, body: { padding: spacing.md, gap: spacing.md },
  // Centers the form on wide/tablet-web while staying full-width on phone.
  content: { width: "100%" as const, maxWidth: 640, alignSelf: "center" as const, gap: spacing.md },
  backLink: { alignSelf: "flex-start" as const, paddingVertical: spacing.xs },
  backLinkText: { color: c.textMuted, fontSize: typography.sizeSm },
  heading: { color: c.text, fontSize: typography.sizeXxl, fontFamily: FRAUNCES.bold, letterSpacing: -0.56 },
  subhead: { color: c.textSecondary, fontSize: typography.sizeMd, marginTop: -spacing.sm },
  field: { gap: spacing.xs },
  required: { color: c.error },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: spacing.sm, color: c.text, fontSize: typography.sizeMd, backgroundColor: c.surface },
  inputMultiline: { minHeight: 72 },
  row: { flexDirection: "row" as const, gap: spacing.md },
  col: { gap: spacing.md },
  rowItem: { flex: 1 },
  // Layout only — the fill/text now come from <Button variant="primary">,
  // which this style overrides onto (Studio re-skin P1).
  submitBtn: { borderRadius: radius.full, alignSelf: "flex-start" as const, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  capHint: { color: c.textMuted, fontSize: typography.sizeSm },
});
