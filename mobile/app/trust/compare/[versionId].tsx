import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { useAuth } from "@/auth/AuthProvider";
import { getVersion, type VersionDetailView, type DraftSection } from "@/api/trustClient";
import { useTrustProject } from "@/hooks/useTrustProject";
import { ApiError } from "@/api/client";
import { versionTimestamp } from "@/lib/versionTimestamp";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import { useTheme, useThemedStyles } from "@/theme";

type Status = "same" | "changed" | "added" | "removed";

function TrustCompareInner() {
  const { versionId, b, artifactId, projectId } = useLocalSearchParams<{
    versionId: string; b: string; artifactId: string; projectId: string;
  }>();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { accessToken } = useAuth();
  const { project } = useTrustProject(String(projectId));
  const wide = useWindowDimensions().width >= 700;

  const [a, setA] = useState<VersionDetailView | null>(null);
  const [bVersion, setBVersion] = useState<VersionDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) {
      setError("Please sign in to compare versions.");
      return;
    }
    let live = true;
    void (async () => {
      try {
        const [av, bv] = await Promise.all([
          getVersion(String(versionId), accessToken),
          getVersion(String(b), accessToken),
        ]);
        if (live) { setA(av); setBVersion(bv); }
      } catch (e) {
        if (live) setError(e instanceof ApiError ? e.userMessage() : "Couldn't load one of the versions.");
      }
    })();
    return () => { live = false; };
  }, [accessToken, versionId, b]);

  // input id -> "S1".."Sn", mirroring the #370 viewer's labelFor.
  const labelFor = useMemo(() => {
    const m = new Map<string, string>();
    (project?.inputs ?? []).forEach((inp, i) => m.set(inp.id, `S${i + 1}`));
    return m;
  }, [project]);

  const rows = useMemo(() => {
    const aSecs = a?.content?.sections ?? [];
    const bSecs = bVersion?.content?.sections ?? [];
    const n = Math.max(aSecs.length, bSecs.length);
    const out: { i: number; a: DraftSection | null; b: DraftSection | null; status: Status }[] = [];
    for (let i = 0; i < n; i++) {
      const sa = aSecs[i] ?? null;
      const sb = bSecs[i] ?? null;
      let status: Status;
      if (sa && sb) {
        status = sa.heading !== sb.heading || sa.body !== sb.body ? "changed" : "same";
      } else if (sa && !sb) {
        status = "removed";
      } else {
        status = "added";
      }
      out.push({ i, a: sa, b: sb, status });
    }
    return out;
  }, [a, bVersion]);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </View>
    );
  }
  if (!a || !bVersion) return <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>;

  const renderCell = (s: DraftSection | null, status: Status) => (
    <View style={[styles.cell, styles[`tint_${status}`]]}>
      {s ? (
        <>
          <Text style={styles.heading}>{s.heading}</Text>
          <Text style={styles.bodyText}>{s.body}</Text>
          {(s.source_ids ?? []).length > 0 ? (
            <View style={styles.citeRow}>
              {(s.source_ids ?? []).map((id) => (
                <Text key={id} style={styles.cite}>{labelFor.get(id) ?? "cited"}</Text>
              ))}
            </View>
          ) : null}
        </>
      ) : (
        <Text style={styles.empty}>— no section —</Text>
      )}
    </View>
  );

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
      <PageContainer style={{ flex: 1 }}>
        <Text style={styles.title}>
          v{a.version_no} · {versionTimestamp(a.created_at)} ↔ v{bVersion.version_no} · {versionTimestamp(bVersion.created_at)}
        </Text>
        <View style={styles.headerRow}>
          <View style={styles.headerSide}>
            <Text style={styles.headerNote}>
              {a.is_validated ? (a.recorded_via === "expert_self" ? "expert-validated" : "operator-recorded") : "awaiting review"}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open v${a.version_no}`}
              onPress={() => router.push({ pathname: "/trust/version/[versionId]", params: { versionId: a.id, artifactId: String(artifactId), projectId: String(projectId) } })}
            >
              <Text style={styles.openLink}>Open v{a.version_no}</Text>
            </Pressable>
          </View>
          <View style={styles.headerSide}>
            <Text style={styles.headerNote}>
              {bVersion.is_validated ? (bVersion.recorded_via === "expert_self" ? "expert-validated" : "operator-recorded") : "awaiting review"}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open v${bVersion.version_no}`}
              onPress={() => router.push({ pathname: "/trust/version/[versionId]", params: { versionId: bVersion.id, artifactId: String(artifactId), projectId: String(projectId) } })}
            >
              <Text style={styles.openLink}>Open v{bVersion.version_no}</Text>
            </Pressable>
          </View>
        </View>
        {rows.map((row) => (
          <View key={row.i} testID={`section-${row.i}-${row.status}`} style={wide ? styles.rowWide : styles.rowStacked}>
            {renderCell(row.a, row.status)}
            {renderCell(row.b, row.status)}
          </View>
        ))}
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </PageContainer>
    </ScrollView>
  );
}

export default function TrustCompare() {
  // Follows the user's selected theme (ADR-038 O1 reversed) — no forced SmeThemeScope.
  return <TrustCompareInner />;
}

const makeStyles = (c: Palette) => ({
  scroll: { flex: 1 as const, backgroundColor: c.background },
  body: { padding: spacing.md, gap: spacing.md },
  center: { flex: 1 as const, alignItems: "center" as const, justifyContent: "center" as const, padding: spacing.xl, gap: spacing.md },
  title: { color: c.text, fontSize: typography.sizeLg, fontFamily: FRAUNCES.semibold, letterSpacing: -0.36 },
  headerRow: { flexDirection: "row" as const, gap: spacing.md },
  headerSide: { flex: 1 as const, flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, gap: spacing.sm },
  headerNote: { color: c.textMuted, fontSize: typography.sizeSm },
  openLink: { color: c.primary, fontSize: typography.sizeSm },
  rowWide: { flexDirection: "row" as const, gap: spacing.md },
  rowStacked: { flexDirection: "column" as const, gap: spacing.sm },
  cell: { flex: 1 as const, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md, gap: spacing.sm },
  tint_same: { backgroundColor: c.surface },
  tint_changed: { backgroundColor: c.warning + "22" },
  tint_added: { backgroundColor: c.success + "22" },
  tint_removed: { backgroundColor: c.error + "22" },
  heading: { color: c.text, fontSize: typography.sizeMd, fontFamily: FRAUNCES.semibold, letterSpacing: -0.36 },
  bodyText: { color: c.text, fontSize: typography.sizeMd, lineHeight: 22 as const },
  empty: { color: c.textMuted, fontSize: typography.sizeSm, fontStyle: "italic" as const },
  citeRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: spacing.xs },
  cite: { color: c.textMuted, fontSize: typography.sizeSm, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, paddingHorizontal: spacing.xs },
  error: { color: c.error, fontSize: typography.sizeMd },
  backBtn: { alignSelf: "flex-start" as const, paddingVertical: spacing.sm },
  backText: { color: c.primary, fontSize: typography.sizeMd },
});
