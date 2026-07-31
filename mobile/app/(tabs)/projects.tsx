import { useRouter, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { AccentText } from "@/components/AccentText";
import { RequireSignIn } from "@/auth/RequireSignIn";
import { useOwnedProjects } from "@/hooks/useOwnedProjects";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import { SmeThemeScope, useTheme, useThemedStyles } from "@/theme";

function ProjectsInner() {
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { projects, loading, error, refresh } = useOwnedProjects();
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  return (
    <View style={styles.wrap}>
      <Pressable accessibilityRole="button" accessibilityLabel="New project" style={styles.newBtn} onPress={() => router.push("/trust/new")}>
        <Text style={styles.newBtnText}>+ New project</Text>
      </Pressable>
      {loading ? <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>
        : error ? <View style={styles.center}><Text style={styles.error}>{error}</Text></View>
        : projects.length === 0 ? <View style={styles.center}><Text style={styles.empty}>No <AccentText>projects</AccentText> yet.</Text><Text style={styles.emptySub}>Create one to capture and validate expert knowledge.</Text></View>
        : <FlatList data={projects} keyExtractor={(p) => p.id} contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <Pressable accessibilityRole="button" accessibilityLabel={`Open project: ${item.title}`} style={styles.row} onPress={() => router.push(`/trust/${item.id}`)}>
                <View style={{ flex: 1 }}><Text style={styles.rowTitle}>{item.title}</Text><Text style={styles.rowMeta}>{item.status}</Text></View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            )} />}
    </View>
  );
}
export default function ProjectsScreen() {
  // SME surface → always the Navy Trust brand (ADR-038). Scope wraps the content
  // (not the sign-in gate) so ProjectsInner's useThemedStyles resolves navy-trust.
  return (
    <RequireSignIn action="manage projects">
      <SmeThemeScope>
        {/* flex:1 so the FlatList/centered-empty (flex:1) has a bounded parent —
            without it the content collapses to 0 height on native (New Arch). */}
        <PageContainer style={{ flex: 1 }}><ProjectsInner /></PageContainer>
      </SmeThemeScope>
    </RequireSignIn>
  );
}
const makeStyles = (c: Palette) => ({
  wrap: { flex: 1 },
  newBtn: { margin: spacing.md, backgroundColor: c.primary, borderRadius: radius.md, padding: spacing.md, alignItems: "center" as const },
  newBtnText: { color: c.primaryText, fontWeight: "700" as const, fontSize: typography.sizeMd },
  center: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, padding: spacing.xl },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  row: { flexDirection: "row" as const, alignItems: "center" as const, backgroundColor: c.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: c.border },
  rowTitle: { color: c.text, fontSize: typography.sizeLg, fontFamily: FRAUNCES.semibold, letterSpacing: -0.36 },
  rowMeta: { color: c.textSecondary, fontSize: typography.sizeSm, marginTop: 2 },
  chevron: { color: c.textMuted, fontSize: typography.sizeXl },
  empty: { color: c.text, fontSize: typography.sizeLg, fontFamily: FRAUNCES.semibold, letterSpacing: -0.36 },
  emptySub: { color: c.textSecondary, fontSize: typography.sizeSm, marginTop: spacing.xs, textAlign: "center" as const },
  error: { color: c.error, fontSize: typography.sizeMd, textAlign: "center" as const },
});
