import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { PageContainer } from "@/components/PageContainer";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { IS_DEMO } from "@/constants/demo";

export default function SignInScreen() {
  const router = useRouter();
  const { signIn, signUp, signInWithGoogle, status } = useAuth();
  const [mode, setMode] = useState<"sign_in" | "sign_up">("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "signed_in") return <Redirect href="/account" />;
  if (status === "unavailable") {
    return (
      <PageContainer>
        <Text style={styles.note}>
          {IS_DEMO
            ? "Accounts and cross-device sync aren’t available in this demo build. Enjoy the included books — no sign-in needed."
            : "Sign-in isn’t configured in this build. Add your Supabase project keys (EXPO_PUBLIC_SUPABASE_URL / ANON_KEY) to enable accounts."}
        </Text>
      </PageContainer>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    const fn = mode === "sign_in" ? signIn : signUp;
    const { error: err } = await fn(email.trim(), password);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    router.replace("/account");
  };

  const onGoogle = async () => {
    setGoogleBusy(true);
    setError(null);
    const { error: err } = await signInWithGoogle();
    setGoogleBusy(false);
    if (err) {
      setError(err);
      return;
    }
    // On success the auth listener flips status to "signed_in" and the Redirect above
    // takes over; nudge the router too in case we're already mounted.
    router.replace("/account");
  };

  const anyBusy = busy || googleBusy;
  const canSubmit = email.trim().length > 3 && password.length >= 6 && !anyBusy;

  return (
    <PageContainer>
      <Text style={styles.title}>{mode === "sign_in" ? "Sign in" : "Create account"}</Text>
      <Text style={styles.sub}>Your account syncs your library and provider settings across devices.</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor={colors.textMuted}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.button, !canSubmit && styles.buttonDisabled]}
        disabled={!canSubmit}
        onPress={submit}
      >
        {busy ? (
          <ActivityIndicator color={colors.primaryText} />
        ) : (
          <Text style={styles.buttonText}>{mode === "sign_in" ? "Sign in" : "Create account"}</Text>
        )}
      </Pressable>

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.dividerLine} />
      </View>

      <Pressable
        style={[styles.googleButton, anyBusy && styles.buttonDisabled]}
        disabled={anyBusy}
        onPress={onGoogle}
      >
        {googleBusy ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <Text style={styles.googleButtonText}>Continue with Google</Text>
        )}
      </Pressable>

      <Pressable
        style={styles.switch}
        onPress={() => {
          setError(null);
          setMode((m) => (m === "sign_in" ? "sign_up" : "sign_in"));
        }}
      >
        <Text style={styles.switchText}>
          {mode === "sign_in" ? "No account? Create one" : "Have an account? Sign in"}
        </Text>
      </Pressable>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: typography.sizeXxl, fontWeight: "700", marginBottom: spacing.xs },
  sub: { color: colors.textSecondary, fontSize: typography.sizeSm, marginBottom: spacing.lg },
  note: { color: colors.textSecondary, fontSize: typography.sizeMd, lineHeight: 22 },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.sizeMd,
    marginBottom: spacing.sm,
  },
  error: { color: colors.error, fontSize: typography.sizeSm, marginBottom: spacing.sm },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.primaryText, fontSize: typography.sizeMd, fontWeight: "700" },
  divider: { flexDirection: "row", alignItems: "center", marginVertical: spacing.lg },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textMuted, fontSize: typography.sizeSm, marginHorizontal: spacing.md },
  googleButton: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  googleButtonText: { color: colors.text, fontSize: typography.sizeMd, fontWeight: "600" },
  switch: { alignItems: "center", marginTop: spacing.lg },
  switchText: { color: colors.primary, fontSize: typography.sizeSm },
});
