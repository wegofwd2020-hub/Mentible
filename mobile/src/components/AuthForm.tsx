import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

// The email + Google sign-in/up form, extracted from the sign-in screen so the
// same flow can be reused inside the first-run wizard (SignupStep). The host is
// responsible for the surrounding chrome and for handling the `signed_in` /
// `unavailable` auth states — this component assumes it is only rendered when a
// user can actually sign in, and calls `onAuthenticated` once they have.
export interface AuthFormProps {
  // Invoked after a successful sign-in / sign-up / Google auth (no error). The
  // `mode` says which action completed — useful because a successful email
  // sign-up may still require email confirmation before a session exists, so the
  // caller can show a "check your email" hint rather than assume signed-in.
  onAuthenticated?: (info: { mode: "sign_in" | "sign_up" }) => void;
  initialMode?: "sign_in" | "sign_up";
  // Show the built-in title + subtitle (the screen wants it; the wizard supplies
  // its own header via the scaffold and sets this false).
  showHeader?: boolean;
}

export function AuthForm({
  onAuthenticated,
  initialMode = "sign_in",
  showHeader = true,
}: AuthFormProps) {
  const { signIn, signUp, signInWithGoogle } = useAuth();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [mode, setMode] = useState<"sign_in" | "sign_up">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    onAuthenticated?.({ mode });
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
    // Google is an interactive sign-in (never a deferred email confirmation).
    onAuthenticated?.({ mode: "sign_in" });
  };

  const anyBusy = busy || googleBusy;
  const canSubmit = email.trim().length > 3 && password.length >= 6 && !anyBusy;

  return (
    <View>
      {showHeader ? (
        <>
          <Text style={styles.title}>{mode === "sign_in" ? "Sign in" : "Create account"}</Text>
          <Text style={styles.sub}>
            Your account syncs your library and provider settings across devices.
          </Text>
        </>
      ) : null}

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={theme.textMuted}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor={theme.textMuted}
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
          <ActivityIndicator color={theme.primaryText} />
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
          <ActivityIndicator color={theme.text} />
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
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  title: { color: c.text, fontSize: typography.sizeXxl, fontWeight: "700" as const, marginBottom: spacing.xs },
  sub: { color: c.textSecondary, fontSize: typography.sizeSm, marginBottom: spacing.lg },
  input: {
    backgroundColor: c.surface,
    color: c.text,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.sizeMd,
    marginBottom: spacing.sm,
  },
  error: { color: c.error, fontSize: typography.sizeSm, marginBottom: spacing.sm },
  button: {
    backgroundColor: c.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center" as const,
    marginTop: spacing.sm,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: c.primaryText, fontSize: typography.sizeMd, fontWeight: "700" as const },
  divider: { flexDirection: "row" as const, alignItems: "center" as const, marginVertical: spacing.lg },
  dividerLine: { flex: 1, height: 1, backgroundColor: c.border },
  dividerText: { color: c.textMuted, fontSize: typography.sizeSm, marginHorizontal: spacing.md },
  googleButton: {
    backgroundColor: c.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    paddingVertical: spacing.md,
    alignItems: "center" as const,
  },
  googleButtonText: { color: c.text, fontSize: typography.sizeMd, fontWeight: "600" as const },
  switch: { alignItems: "center" as const, marginTop: spacing.lg },
  switchText: { color: c.primary, fontSize: typography.sizeSm },
});
