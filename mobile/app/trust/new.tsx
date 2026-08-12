import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { RequireSignIn } from "@/auth/RequireSignIn";
import { Alert } from "@/lib/alert";
import { useOwnedProjects } from "@/hooks/useOwnedProjects";
import { ApiError } from "@/api/client";
import { PLAYFAIR } from "@/constants/fonts";
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
  const field = (label: string, v: string, set: (s: string) => void, placeholder: string) => (
    <View style={styles.field}><Label tone="secondary">{label}</Label>
      <TextInput value={v} onChangeText={set} style={styles.input} placeholder={placeholder} placeholderTextColor={theme.textMuted} accessibilityLabel={label} /></View>
  );
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.body}><PageContainer>
      <Text style={styles.heading}>New project</Text>
      <Text style={styles.subhead}>Give your studio a topic to work on. You can refine any of this later.</Text>
      {field("Title", title, setTitle, "Post-mortems that change engineering culture")}
      {field("Topic", topic, setTopic, "The specific insight or angle you want to develop")}
      {field("Audience", audience, setAudience, "Senior engineering leaders")}
      {field("Goal", goal, setGoal, "Teach · Thought leadership · Lead-gen")}
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
  heading: { color: c.text, fontSize: typography.sizeXxl, fontFamily: PLAYFAIR.bold, letterSpacing: -0.56 },
  subhead: { color: c.textSecondary, fontSize: typography.sizeMd, marginTop: -spacing.sm },
  field: { gap: spacing.xs },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: spacing.sm, color: c.text, fontSize: typography.sizeMd, backgroundColor: c.surface },
  // Layout only — the fill/text now come from <Button variant="primary">,
  // which this style overrides onto (Studio re-skin P1).
  submitBtn: { marginTop: spacing.sm },
});
