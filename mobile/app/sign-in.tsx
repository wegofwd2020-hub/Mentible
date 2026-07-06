import React from "react";
import { StyleSheet, Text } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { AuthForm } from "@/components/AuthForm";
import { PageContainer } from "@/components/PageContainer";
import { HelpButton } from "@/help";
import { colors, typography } from "@/constants/theme";
import { IS_DEMO } from "@/constants/demo";

export default function SignInScreen() {
  const router = useRouter();
  const { status } = useAuth();

  if (status === "signed_in") return <Redirect href="/library" />;
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

  return (
    <PageContainer>
      <HelpButton topic="getting-started-account" label="About accounts" />
      <AuthForm onAuthenticated={() => router.replace("/library")} />
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  note: { color: colors.textSecondary, fontSize: typography.sizeMd, lineHeight: 22 },
});
