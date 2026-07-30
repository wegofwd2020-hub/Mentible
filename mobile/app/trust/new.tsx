import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { RequireSignIn } from "@/auth/RequireSignIn";
import { Alert } from "@/lib/alert";
import { useOwnedProjects } from "@/hooks/useOwnedProjects";
import { ApiError } from "@/api/client";
import { colors, radius, spacing, typography } from "@/constants/theme";

export default function NewProjectScreen() {
  const router = useRouter();
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
      <TextInput value={v} onChangeText={set} style={styles.input} placeholderTextColor={colors.textMuted} accessibilityLabel={label} /></View>
  );
  return (
    <RequireSignIn action="start a project">
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}><PageContainer>
        {field("Title", title, setTitle)}
        {field("Topic", topic, setTopic)}
        {field("Audience", audience, setAudience)}
        {field("Goal", goal, setGoal)}
        <Pressable accessibilityRole="button" accessibilityLabel="Create project" disabled={busy} style={styles.submit} onPress={submit}>
          <Text style={styles.submitText}>{busy ? "…" : "Create project"}</Text>
        </Pressable>
      </PageContainer></ScrollView>
    </RequireSignIn>
  );
}
const styles = StyleSheet.create({
  scroll: { flex: 1 }, body: { padding: spacing.md, gap: spacing.md },
  field: { gap: spacing.xs }, label: { color: colors.textSecondary, fontSize: typography.sizeSm },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, fontSize: typography.sizeMd, backgroundColor: colors.surface },
  submit: { backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: "center", marginTop: spacing.sm },
  submitText: { color: colors.primaryText, fontWeight: "700", fontSize: typography.sizeMd },
});
