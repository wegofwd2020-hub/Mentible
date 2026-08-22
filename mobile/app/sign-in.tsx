import React from "react";
import { Text } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { AuthForm } from "@/components/AuthForm";
import { PageContainer } from "@/components/PageContainer";
import { HelpButton } from "@/help";
import { typography, type Palette } from "@/constants/theme";
import { IS_DEMO } from "@/constants/demo";
import { useThemedStyles } from "@/theme";

export default function SignInScreen() {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const { status } = useAuth();

  if (status === "signed_in") return <Redirect href="/" />;
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
      <AuthForm onAuthenticated={() => router.replace("/")} />
    </PageContainer>
  );
}

const makeStyles = (c: Palette) => ({
  note: { color: c.textSecondary, fontSize: typography.sizeMd, lineHeight: 22 },
});
