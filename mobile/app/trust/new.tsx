import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { RequireSignIn } from "@/auth/RequireSignIn";
import { Alert } from "@/lib/alert";
import { useOwnedProjects } from "@/hooks/useOwnedProjects";
import { ApiError } from "@/api/client";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";
import { Button, Label } from "@/components/ui";

function NewProjectInner() {
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { create } = useOwnedProjects();
  const [title, setTitle] = useState(""); const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState(""); const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!title.trim()) { Alert.alert("Title required", "Give the project a title."); return; }
    setBusy(true);
    try {
      const p = await create({ title: title.trim(), topic: topic.trim() || undefined, audience: audience.trim() || undefined, goal: goal.trim() || undefined });
      router.replace(`/trust/${p.id}`);
    } catch (e) { Alert.alert("Couldn't create", e instanceof ApiError ? e.userMessage() : "Please try again."); }
    finally { setBusy(false); }
  };
  const field = (label: string, v: string, set: (s: string) => void) => (
    <View style={styles.field}><Label tone="secondary">{label}</Label>
      <TextInput value={v} onChangeText={set} style={styles.input} placeholderTextColor={theme.textMuted} accessibilityLabel={label} /></View>
  );
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.body}><PageContainer>
      {field("Title", title, setTitle)}
      {field("Topic", topic, setTopic)}
      {field("Audience", audience, setAudience)}
      {field("Goal", goal, setGoal)}
      <Button
        variant="primary"
        label="Create project"
        onPress={submit}
        busy={busy}
        accessibilityLabel="Create project"
        style={styles.submitBtn}
      />
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
  scroll: { flex: 1, backgroundColor: c.background }, body: { padding: spacing.md, gap: spacing.md },
  field: { gap: spacing.xs },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: spacing.sm, color: c.text, fontSize: typography.sizeMd, backgroundColor: c.surface },
  // Layout only — the fill/text now come from <Button variant="primary">,
  // which this style overrides onto (Studio re-skin P1).
  submitBtn: { marginTop: spacing.sm },
});
