import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput } from "react-native";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { useAccount } from "@/hooks/useAccount";
import { sendWelcomeEmail } from "@/api/adminClient";
import { PageContainer } from "@/components/PageContainer";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

// Super-admin: send the Mentible welcome email to any address (ADR-020). The
// recipient need not have an account — good for onboarding testers before they
// sign up. Prefills from ?email / ?name query params when launched from a user
// row's "Send welcome" button.
export default function AdminWelcomeScreen() {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { status, accessToken } = useAuth();
  const { account } = useAccount();
  const isAdmin = account?.is_super_admin === true;

  const params = useLocalSearchParams<{ email?: string; name?: string }>();
  const [email, setEmail] = useState(params.email ?? "");
  const [name, setName] = useState(params.name ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const canSend = email.includes("@") && !busy;

  const send = async () => {
    if (!accessToken || !canSend) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await sendWelcomeEmail(accessToken, email.trim(), name.trim() || undefined);
      setResult(
        res.sent
          ? { ok: true, text: `Sent to ${email.trim()}.` }
          : { ok: false, text: `Not sent — ${res.detail}` },
      );
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "Couldn’t send. Try again." });
    } finally {
      setBusy(false);
    }
  };

  if (status === "unavailable") return <Redirect href="/settings" />;
  if (status === "signed_out" || status === "loading") return <Redirect href="/sign-in" />;
  if (account && !isAdmin) return <Redirect href="/settings" />;

  return (
    <PageContainer style={{ flex: 1 }}>
      <Text style={styles.title}>Send welcome email</Text>
      <Text style={styles.sub}>
        Sends the Mentible welcome email to any address. They don’t need an account yet.
      </Text>

      <Text style={styles.label}>Recipient email</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="name@example.com"
        placeholderTextColor={theme.textMuted}
        autoCapitalize="none"
        keyboardType="email-address"
        accessibilityLabel="Recipient email"
        editable={!busy}
      />

      <Text style={styles.label}>Name (optional)</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Personalizes the greeting"
        placeholderTextColor={theme.textMuted}
        maxLength={255}
        accessibilityLabel="Recipient name"
        editable={!busy}
      />

      <Pressable
        style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
        onPress={() => void send()}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="Send welcome email"
      >
        {busy ? (
          <ActivityIndicator color={theme.primaryText} />
        ) : (
          <Text style={styles.sendText}>Send welcome email</Text>
        )}
      </Pressable>

      {result ? (
        <Text style={[styles.result, result.ok ? styles.resultOk : styles.resultErr]}>
          {result.text}
        </Text>
      ) : null}
    </PageContainer>
  );
}

const makeStyles = (c: Palette) => ({
  title: { color: c.text, fontSize: typography.sizeXxl, fontWeight: "700" as const },
  sub: { color: c.textSecondary, fontSize: typography.sizeSm, marginBottom: spacing.lg },
  label: {
    color: c.textSecondary,
    fontSize: typography.sizeSm,
    fontWeight: "600" as const,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  input: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: c.text,
    fontSize: typography.sizeMd,
    backgroundColor: c.surface,
  },
  sendBtn: {
    marginTop: spacing.lg,
    backgroundColor: c.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center" as const,
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendText: { color: c.primaryText, fontSize: typography.sizeMd, fontWeight: "700" as const },
  result: { marginTop: spacing.md, fontSize: typography.sizeSm },
  resultOk: { color: c.success },
  resultErr: { color: c.error },
});
