import { useRouter, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { RequireSignIn } from "@/auth/RequireSignIn";
import { useOwnedProjects } from "@/hooks/useOwnedProjects";
import { useBillingPlan } from "@/hooks/useBillingPlan";
import { useResponsive } from "@/hooks/useResponsive";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import { useTheme, useThemedStyles } from "@/theme";
import { Button, Card, Label } from "@/components/ui";
import type { ProjectSummaryView } from "@/api/trustClient";

// The New-project pill: primary CTA that opens `/trust/new`. Preserves the
// Free/Pro project cap wall (Slice B, mirrored from app/trust/new.tsx) — UX
// only, fails open on an unknown plan (signed out / still loading / a failed
// billing fetch never disables Create; the server is the real gate).
function NewProjectButton({
  label, accessibilityLabel, atProjectCap, style,
}: { label: string; accessibilityLabel?: string; atProjectCap: boolean; style?: StyleProp<ViewStyle> }) {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={style}>
      <Button
        variant="primary"
        label={label}
        onPress={() => router.push("/trust/new")}
        disabled={atProjectCap}
        accessibilityLabel={accessibilityLabel ?? label}
      />
      {atProjectCap ? (
        <Pressable
          onPress={() => router.push("/usage")}
          accessibilityRole="button"
          accessibilityLabel="Free limit reached — upgrade to Pro"
        >
          <Text style={styles.capHint}>Free limit reached — upgrade to Pro</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ProjectCard({ item }: { item: ProjectSummaryView }) {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const footer = [item.audience, item.goal].filter(Boolean).join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open project: ${item.title}`}
      onPress={() => router.push(`/trust/${item.id}`)}
      style={({ pressed }) => [styles.cardWrap, pressed && styles.cardPressed]}
    >
      <Card>
        <View style={styles.cardTop}>
          <Text style={styles.statusGlyph}>●</Text>
          <Label>{item.status.replace(/_/g, " ")}</Label>
        </View>
        <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
        {item.topic ? <Text style={styles.cardTopic} numberOfLines={3}>{item.topic}</Text> : null}
        {footer ? <Text style={styles.cardFooter} numberOfLines={1}>{footer}</Text> : null}
      </Card>
    </Pressable>
  );
}

function ProjectsInner() {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isTablet } = useResponsive();
  const { plan } = useBillingPlan();
  const { projects, loading, error, refresh } = useOwnedProjects();
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const atProjectCap = plan != null && !plan.is_pro && plan.at_project_cap;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View>
          <Label style={styles.kicker}>YOUR STUDIO</Label>
          <Text style={styles.title}>Projects</Text>
        </View>
        {isTablet ? (
          <NewProjectButton label="+ New project" accessibilityLabel="New project" atProjectCap={atProjectCap} style={styles.headerBtn} />
        ) : null}
      </View>
      {!isTablet ? (
        <NewProjectButton label="+ New project" accessibilityLabel="New project" atProjectCap={atProjectCap} style={styles.phoneBtn} />
      ) : null}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>
      ) : error ? (
        <View style={styles.center}><Text style={styles.error}>{error}</Text></View>
      ) : projects.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyCard}>
            <Text style={styles.emptyGlyph}>✦</Text>
            <Text style={styles.emptyTitle}>Your first project awaits</Text>
            <Text style={styles.emptyBody}>
              A project is one topic you want to develop — feed the studio your transcripts and
              notes, and get drafts across every format.
            </Text>
            <NewProjectButton label="Create project" atProjectCap={atProjectCap} style={styles.emptyBtn} />
          </View>
        </View>
      ) : (
        <FlatList
          key={isTablet ? "grid2" : "grid1"}
          data={projects}
          keyExtractor={(p) => p.id}
          numColumns={isTablet ? 2 : 1}
          columnWrapperStyle={isTablet ? styles.gridRow : undefined}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={isTablet ? styles.gridItem : undefined}>
              <ProjectCard item={item} />
            </View>
          )}
        />
      )}
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
  header: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "flex-start" as const,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  kicker: { letterSpacing: 1.5 },
  title: {
    color: c.text, fontSize: 32, fontFamily: FRAUNCES.semibold, letterSpacing: -0.6, marginTop: spacing.xs,
  },
  headerBtn: { alignItems: "flex-end" as const, gap: spacing.xs },
  phoneBtn: { margin: spacing.md, gap: spacing.xs },
  capHint: { color: c.textMuted, fontSize: typography.sizeSm, marginTop: spacing.xs, textAlign: "right" as const },

  center: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, padding: spacing.xl },
  error: { color: c.error, fontSize: typography.sizeMd, textAlign: "center" as const },

  // Empty state — a dashed-border card, matching the Studio "not filled yet"
  // convention (borderStyle:"dashed" rather than a solid Card).
  emptyCard: {
    borderWidth: 1,
    borderStyle: "dashed" as const,
    borderColor: c.border,
    borderRadius: radius.lg,
    alignItems: "center" as const,
    padding: spacing.xl,
    maxWidth: 420,
    gap: spacing.sm,
  },
  emptyGlyph: { fontSize: 40, color: c.primary, marginBottom: spacing.xs },
  emptyTitle: { color: c.text, fontSize: typography.sizeXl, fontFamily: FRAUNCES.semibold, letterSpacing: -0.36, textAlign: "center" as const },
  emptyBody: { color: c.textSecondary, fontSize: typography.sizeSm, textAlign: "center" as const, lineHeight: 22 },
  emptyBtn: { marginTop: spacing.sm, alignItems: "center" as const, gap: spacing.xs },

  // Card grid.
  list: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: spacing.md },
  gridRow: { gap: spacing.md },
  gridItem: { flex: 1, maxWidth: "50%" as const },
  cardWrap: { flex: 1 },
  cardPressed: { opacity: 0.7 },
  cardTop: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs, marginBottom: spacing.xs },
  statusGlyph: { color: c.primary, fontSize: 8 },
  cardTitle: { color: c.text, fontSize: typography.sizeXl, fontFamily: FRAUNCES.semibold, letterSpacing: -0.36, marginBottom: spacing.xs },
  cardTopic: { color: c.textSecondary, fontSize: typography.sizeSm, lineHeight: 20, marginBottom: spacing.sm },
  // Mirrors <Label>'s uppercase/tracked/muted look — plain Text here (not
  // <Label>) because this line needs numberOfLines truncation, which <Label>
  // doesn't pass through.
  cardFooter: {
    color: c.textMuted,
    fontSize: typography.sizeXs,
    textTransform: "uppercase" as const,
    letterSpacing: Math.round(typography.sizeXs * 0.14),
    fontWeight: "500" as const,
  },
});
