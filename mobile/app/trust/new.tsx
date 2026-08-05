import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { RequireSignIn } from "@/auth/RequireSignIn";
import { Alert } from "@/lib/alert";
import { useOwnedProjects } from "@/hooks/useOwnedProjects";
import { ApiError } from "@/api/client";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

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
    <View style={styles.field}><Text style={styles.label}>{label}</Text>
      <TextInput value={v} onChangeText={set} style={styles.input} placeholderTextColor={theme.textMuted} accessibilityLabel={label} /></View>
  );
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.body}><PageContainer>
      {field("Title", title, setTitle)}
      {field("Topic", topic, setTopic)}
      {field("Audience", audience, setAudience)}
      {field("Goal", goal, setGoal)}
      <Pressable accessibilityRole="button" accessibilityLabel="Create project" disabled={busy} style={styles.submit} onPress={submit}>
        <Text style={styles.submitText}>{busy ? "…" : "Create project"}</Text>
      </Pressable>
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
  field: { gap: spacing.xs }, label: { color: c.textSecondary, fontSize: typography.sizeSm },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: spacing.sm, color: c.text, fontSize: typography.sizeMd, backgroundColor: c.surface },
  submit: { backgroundColor: c.primary, borderRadius: radius.md, padding: spacing.md, alignItems: "center" as const, marginTop: spacing.sm },
  submitText: { color: c.primaryText, fontWeight: "700" as const, fontSize: typography.sizeMd },
});
