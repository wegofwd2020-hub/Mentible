import { useRouter, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { AccentText } from "@/components/AccentText";
import { RequireSignIn } from "@/auth/RequireSignIn";
import { useReviews } from "@/hooks/useReviews";
import { useAuth } from "@/auth/AuthProvider";
import { approveVersion, withdrawApproval } from "@/api/trustClient";
import { ApiError } from "@/api/client";
import { Alert } from "@/lib/alert";
import { spacing, typography, type Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import { useTheme, useThemedStyles } from "@/theme";
import { Button, Card } from "@/components/ui";

function VersionRow({ version, onApprove, onWithdraw, busy }: {
  version: { id: string; version_no: number; created_at: string | null; is_validated: boolean; artifactTitle: string };
  onApprove: () => void;
  onWithdraw: () => void;
  busy: boolean;
}) {
  const styles = useThemedStyles(makeVersionRowStyles);
  const createdDate = version.created_at
    ? new Date(version.created_at).toLocaleDateString()
    : "Unknown";

  return (
    <View style={styles.versionRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.versionTitle}>v{version.version_no} {version.artifactTitle}</Text>
        <Text style={styles.versionMeta}>Created: {createdDate}</Text>
        {version.is_validated && (
          <Text style={styles.approvedBadge}>✓ Approved</Text>
        )}
      </View>
      <View style={styles.actions}>
        {!version.is_validated ? (
          <Button
            variant="primary"
            label="Approve"
            onPress={onApprove}
            busy={busy}
            disabled={busy}
          />
        ) : (
          <Button
            variant="ghost"
            label="Withdraw"
            onPress={onWithdraw}
            busy={busy}
            disabled={busy}
          />
        )}
      </View>
    </View>
  );
}

function ReviewsInner() {
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { reviews, loading, error, refresh } = useReviews();
  const { accessToken } = useAuth();
  const [approvingVersion, setApprovingVersion] = useState<string | null>(null);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const onApprove = useCallback(async (versionId: string) => {
    if (!accessToken) return;
    setApprovingVersion(versionId);
    try {
      await approveVersion(versionId, { approved_at: new Date().toISOString() }, accessToken);
      Alert.alert("Approved", "Version approved ✓");
      await refresh();
    } catch (e) {
      Alert.alert("Couldn't approve", e instanceof ApiError ? e.userMessage() : "Please try again.");
    } finally {
      setApprovingVersion(null);
    }
  }, [accessToken, refresh]);

  const onWithdraw = useCallback(async (versionId: string) => {
    if (!accessToken) return;
    setApprovingVersion(versionId);
    try {
      await withdrawApproval(versionId, {}, accessToken);
      Alert.alert("Withdrawn", "Approval withdrawn");
      await refresh();
    } catch (e) {
      Alert.alert("Couldn't withdraw", e instanceof ApiError ? e.userMessage() : "Please try again.");
    } finally {
      setApprovingVersion(null);
    }
  }, [accessToken, refresh]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>;
  if (error) return <View style={styles.center}><Text style={styles.error}>{error}</Text></View>;
  if (reviews.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>No projects to <AccentText>review</AccentText> yet.</Text>
        <Text style={styles.emptySub}>When an expert invites you, the project appears here.</Text>
      </View>
    );
  }
  return (
    <FlatList
      data={reviews}
      keyExtractor={(r) => r.projectId}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <Card style={styles.projectCard}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open project: ${item.title}`}
            onPress={() => router.push(`/trust/${item.projectId}`)}
            style={styles.projectHeader}
          >
            <Text style={styles.projectTitle}>{item.title}</Text>
            <Text style={styles.projectMeta}>{item.versionsValidated}/{item.versionsTotal} versions validated</Text>
          </Pressable>

          {item.versions.length > 0 && (
            <View style={styles.versionsSection}>
              <Text style={styles.versionsLabel}>Versions to Review</Text>
              {item.versions.map((v) => (
                <VersionRow
                  key={v.id}
                  version={v}
                  onApprove={() => onApprove(v.id)}
                  onWithdraw={() => onWithdraw(v.id)}
                  busy={approvingVersion === v.id}
                />
              ))}
            </View>
          )}
        </Card>
      )}
    />
  );
}

export default function ReviewsScreen() {
  return (
    <RequireSignIn action="review projects">
      <PageContainer style={{ flex: 1 }}>
        <ReviewsInner />
      </PageContainer>
    </RequireSignIn>
  );
}

const makeVersionRowStyles = (c: Palette) => ({
  versionRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  versionTitle: {
    color: c.text,
    fontSize: typography.sizeSm,
    fontFamily: FRAUNCES.medium,
    fontWeight: "600" as const,
  },
  versionMeta: {
    color: c.textSecondary,
    fontSize: typography.sizeXs,
    marginTop: 2,
  },
  approvedBadge: {
    color: c.success || c.textSecondary,
    fontSize: typography.sizeXs,
    marginTop: 4,
    fontWeight: "500" as const,
  },
  actions: {
    marginLeft: spacing.md,
  },
});

const makeStyles = (c: Palette) => ({
  center: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, padding: spacing.xl },
  list: { padding: spacing.md, gap: spacing.md },
  projectCard: { marginBottom: 0 },
  projectHeader: { paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: c.border },
  projectTitle: { color: c.text, fontSize: typography.sizeLg, fontFamily: FRAUNCES.semibold, letterSpacing: -0.36 },
  projectMeta: { color: c.textSecondary, fontSize: typography.sizeSm, marginTop: spacing.xs },
  versionsSection: { paddingTop: spacing.md },
  versionsLabel: { color: c.textSecondary, fontSize: typography.sizeSm, fontFamily: FRAUNCES.medium, fontWeight: "600" as const, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  empty: { color: c.text, fontSize: typography.sizeLg, fontFamily: FRAUNCES.semibold, letterSpacing: -0.36 },
  emptySub: { color: c.textSecondary, fontSize: typography.sizeSm, marginTop: spacing.xs, textAlign: "center" as const },
  error: { color: c.error, fontSize: typography.sizeMd, textAlign: "center" as const },
});
