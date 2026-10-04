import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { useAccount } from "@/hooks/useAccount";
import { PageContainer } from "@/components/PageContainer";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";
import { resolveBaseUrl } from "@/api/client";

interface InterventionConfig {
  intervention_retry_interval_days: number;
  max_intervention_attempts: number;
  note: string;
}

export default function InterventionConfigScreen() {
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { status, accessToken } = useAuth();
  const { account } = useAccount();
  const isAdmin = account?.is_super_admin === true;

  const [config, setConfig] = useState<InterventionConfig | null>(null);
  const [retryInterval, setRetryInterval] = useState("");
  const [maxAttempts, setMaxAttempts] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const baseUrl = resolveBaseUrl();
      const response = await fetch(
        `${baseUrl}/api/v1/admin/analytics/intervention-config`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as InterventionConfig;
      setConfig(data);
      setRetryInterval(String(data.intervention_retry_interval_days));
      setMaxAttempts(String(data.max_intervention_attempts));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load config.");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  const handleSave = useCallback(async () => {
    if (!accessToken || saving) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    const updates: Record<string, number> = {};
    if (retryInterval && retryInterval !== String(config?.intervention_retry_interval_days)) {
      const val = parseInt(retryInterval, 10);
      if (isNaN(val) || val < 1) {
        setError("Retry interval must be a number ≥ 1");
        setSaving(false);
        return;
      }
      updates.intervention_retry_interval_days = val;
    }
    if (maxAttempts && maxAttempts !== String(config?.max_intervention_attempts)) {
      const val = parseInt(maxAttempts, 10);
      if (isNaN(val) || val < 1) {
        setError("Max attempts must be a number ≥ 1");
        setSaving(false);
        return;
      }
      updates.max_intervention_attempts = val;
    }

    if (Object.keys(updates).length === 0) {
      setSuccess("No changes to save.");
      setSaving(false);
      return;
    }

    try {
      const baseUrl = resolveBaseUrl();
      const response = await fetch(
        `${baseUrl}/api/v1/admin/analytics/intervention-config`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(updates),
        }
      );
      if (!response.ok) {
        const errData = (await response.json()) as { detail?: string };
        throw new Error(errData.detail || `HTTP ${response.status}`);
      }
      const result = (await response.json()) as InterventionConfig & { updated: Record<string, number> };
      setConfig((prev) =>
        prev
          ? {
              ...prev,
              intervention_retry_interval_days:
                result.updated.intervention_retry_interval_days ?? prev.intervention_retry_interval_days,
              max_intervention_attempts:
                result.updated.max_intervention_attempts ?? prev.max_intervention_attempts,
            }
          : null
      );
      setSuccess("Config updated (live, no restart needed).");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save config.");
    } finally {
      setSaving(false);
    }
  }, [accessToken, saving, config, retryInterval, maxAttempts]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (status === "unavailable") return <Redirect href="/settings" />;
  if (status === "signed_out" || status === "loading") return <Redirect href="/sign-in" />;
  if (account && !isAdmin) return <Redirect href="/settings" />;

  return (
    <PageContainer style={{ flex: 1 }}>
      <Pressable onPress={() => router.back()}>
        <Text style={styles.backButton}>← Back</Text>
      </Pressable>

      <Text style={styles.title}>Intervention Config</Text>
      <Text style={styles.sub}>Manage user re-engagement intervention settings (live updates)</Text>

      {loading && <ActivityIndicator size="large" color={theme.text} style={{ marginVertical: spacing.lg }} />}

      {!loading && (
        <View style={{ gap: spacing.md }}>
          {error && <Text style={styles.error}>{error}</Text>}
          {success && <Text style={styles.success}>{success}</Text>}

          <View>
            <Text style={styles.label}>Retry Interval (days)</Text>
            <TextInput
              style={styles.input}
              value={retryInterval}
              onChangeText={setRetryInterval}
              keyboardType="number-pad"
              editable={!saving}
              placeholder="e.g. 7"
            />
            <Text style={styles.hint}>Days before retrying intervention for stalled users</Text>
          </View>

          <View>
            <Text style={styles.label}>Max Attempts</Text>
            <TextInput
              style={styles.input}
              value={maxAttempts}
              onChangeText={setMaxAttempts}
              keyboardType="number-pad"
              editable={!saving}
              placeholder="e.g. 3"
            />
            <Text style={styles.hint}>Maximum number of intervention attempts per user</Text>
          </View>

          <Pressable
            style={[styles.button, saving && styles.buttonDisabled]}
            onPress={handleSave}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Save intervention config"
          >
            {saving ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Text style={styles.buttonText}>Save Changes</Text>
            )}
          </Pressable>
        </View>
      )}
    </PageContainer>
  );
}

const makeStyles = (palette: Palette) => ({
  backButton: {
    color: palette.primary,
    fontSize: 16,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: typography.sizeXl,
    color: palette.text,
    marginBottom: spacing.xs,
  },
  sub: {
    fontSize: typography.sizeSm,
    color: palette.textSecondary,
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: typography.sizeSm,
    color: palette.text,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    color: palette.text,
    backgroundColor: palette.background,
  },
  hint: {
    fontSize: typography.sizeXs,
    color: palette.textSecondary,
    marginTop: spacing.xs,
  },
  button: {
    backgroundColor: palette.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center" as const,
    marginTop: spacing.md,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "white",
    fontSize: typography.sizeSm,
  },
  error: {
    color: palette.error,
    fontSize: typography.sizeSm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: `${palette.error}15`,
    borderRadius: radius.sm,
  },
  success: {
    color: palette.success,
    fontSize: typography.sizeSm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: `${palette.success}15`,
    borderRadius: radius.sm,
  },
});
