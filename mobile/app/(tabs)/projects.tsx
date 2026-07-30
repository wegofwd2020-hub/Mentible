import { useRouter, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { RequireSignIn } from "@/auth/RequireSignIn";
import { useOwnedProjects } from "@/hooks/useOwnedProjects";
import { colors, radius, spacing, typography } from "@/constants/theme";

function ProjectsInner() {
  const router = useRouter();
  const { projects, loading, error, refresh } = useOwnedProjects();
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  return (
    <View style={styles.wrap}>
      <Pressable accessibilityRole="button" accessibilityLabel="New project" style={styles.newBtn} onPress={() => router.push("/trust/new")}>
        <Text style={styles.newBtnText}>+ New project</Text>
      </Pressable>
      {loading ? <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        : error ? <View style={styles.center}><Text style={styles.error}>{error}</Text></View>
        : projects.length === 0 ? <View style={styles.center}><Text style={styles.empty}>No projects yet.</Text><Text style={styles.emptySub}>Create one to capture and validate expert knowledge.</Text></View>
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
  return <RequireSignIn action="manage projects"><PageContainer><ProjectsInner /></PageContainer></RequireSignIn>;
}
const styles = StyleSheet.create({
  wrap: { flex: 1 },
  newBtn: { margin: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: "center" },
  newBtnText: { color: colors.primaryText, fontWeight: "700", fontSize: typography.sizeMd },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  rowTitle: { color: colors.text, fontSize: typography.sizeLg, fontWeight: "600" },
  rowMeta: { color: colors.textSecondary, fontSize: typography.sizeSm, marginTop: 2 },
  chevron: { color: colors.textMuted, fontSize: typography.sizeXl },
  empty: { color: colors.text, fontSize: typography.sizeLg, fontWeight: "600" },
  emptySub: { color: colors.textSecondary, fontSize: typography.sizeSm, marginTop: spacing.xs, textAlign: "center" },
  error: { color: colors.error, fontSize: typography.sizeMd, textAlign: "center" },
});
