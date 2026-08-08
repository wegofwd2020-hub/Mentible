import { useRouter, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { AccentText } from "@/components/AccentText";
import { RequireSignIn } from "@/auth/RequireSignIn";
import { useOwnedProjects } from "@/hooks/useOwnedProjects";
import { spacing, typography, type Palette } from "@/constants/theme";
import { PLAYFAIR } from "@/constants/fonts";
import { useTheme, useThemedStyles } from "@/theme";
import { Button, Card, Label } from "@/components/ui";

function ProjectsInner() {
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { projects, loading, error, refresh } = useOwnedProjects();
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  return (
    <View style={styles.wrap}>
      <Button
        variant="primary"
        label="+ New project"
        onPress={() => router.push("/trust/new")}
        accessibilityLabel="New project"
        style={styles.newBtn}
      />
      {loading ? <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>
        : error ? <View style={styles.center}><Text style={styles.error}>{error}</Text></View>
        : projects.length === 0 ? <View style={styles.center}><Text style={styles.empty}>No <AccentText>projects</AccentText> yet.</Text><Text style={styles.emptySub}>Create one to capture and validate expert knowledge.</Text></View>
        : <FlatList data={projects} keyExtractor={(p) => p.id} contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <Pressable accessibilityRole="button" accessibilityLabel={`Open project: ${item.title}`} onPress={() => router.push(`/trust/${item.id}`)}>
                <Card style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{item.title}</Text>
                    <Label tone="secondary" style={styles.rowMeta}>{item.status}</Label>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Card>
              </Pressable>
            )} />}
    </View>
  );
}
export default function ProjectsScreen() {
  // Follows the user's selected theme (ADR-038 O1 reversed — trust surfaces no
  // longer force the Navy Trust brand).
  return (
    <RequireSignIn action="manage projects">
      {/* flex:1 so the FlatList/centered-empty (flex:1) has a bounded parent —
          without it the content collapses to 0 height on native (New Arch). */}
      <PageContainer style={{ flex: 1 }}><ProjectsInner /></PageContainer>
    </RequireSignIn>
  );
}
const makeStyles = (c: Palette) => ({
  wrap: { flex: 1 },
  newBtn: { margin: spacing.md },
  center: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, padding: spacing.xl },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  // Layout only — the surface, border, and padding now come from <Card>,
  // which this style overrides onto (Studio re-skin P1).
  row: { flexDirection: "row" as const, alignItems: "center" as const },
  rowTitle: { color: c.text, fontSize: typography.sizeLg, fontFamily: PLAYFAIR.semibold, letterSpacing: -0.36 },
  rowMeta: { marginTop: 2 },
  chevron: { color: c.textMuted, fontSize: typography.sizeXl },
  empty: { color: c.text, fontSize: typography.sizeLg, fontFamily: PLAYFAIR.semibold, letterSpacing: -0.36 },
  emptySub: { color: c.textSecondary, fontSize: typography.sizeSm, marginTop: spacing.xs, textAlign: "center" as const },
  error: { color: c.error, fontSize: typography.sizeMd, textAlign: "center" as const },
});
