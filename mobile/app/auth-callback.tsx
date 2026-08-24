import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { Redirect, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "@/lib/supabase";

// OAuth redirect target — `mentible://auth-callback` (auth/googleSignIn's
// `makeRedirectUri({ scheme: "mentible", path: "auth-callback" })`).
//
// The in-flow handler (`WebBrowser.openAuthSessionAsync`) normally captures the
// redirect and exchanges the code itself. But some browsers/devices instead
// deliver the redirect to the app as a deep link, which expo-router routes here.
// Without this route that lands on expo-router's "Unmatched route" / NOT FOUND
// screen (reported on a tablet, 2026-08-23). This screen finishes the PKCE
// exchange (idempotent — the code is single-use, so a duplicate just errors and
// is swallowed) and returns Home; AuthProvider's onAuthStateChange then reflects
// the signed-in session.
export default function AuthCallback(): React.JSX.Element {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      WebBrowser.maybeCompleteAuthSession();
      if (code && supabase) {
        await supabase.auth.exchangeCodeForSession(String(code)).catch(() => {});
      }
      if (!cancelled) setDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (done) return <Redirect href="/" />;
  return <View />;
}
