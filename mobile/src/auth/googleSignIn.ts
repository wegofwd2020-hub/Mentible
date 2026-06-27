import "react-native-url-polyfill/auto"; // RN has no global URL — we parse the callback URL
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { makeRedirectUri } from "expo-auth-session";
import type { SupabaseClient } from "@supabase/supabase-js";

// Dismisses a lingering auth session if the app is reopened mid-flow (web/no-op native).
WebBrowser.maybeCompleteAuthSession();

// Google sign-in via Supabase OAuth (ADR-014 D1 — methods: email + Google).
//
// Native uses the PKCE + system-browser flow: Supabase hands us an authorize URL, we
// open it in a secure auth session, then exchange the returned `?code` for a session
// (the verifier lives in encrypted secure-store, never leaving the device). The JWT
// that results is identical in shape to the email/password one, so the backend's JWKS
// verify needs no change. On web we let Supabase perform the redirect and pick the
// session up from the return URL (detectSessionInUrl, web-only — see lib/supabase).
//
// The returned token is OUR/the IdP's session JWT, never an LLM key (CLAUDE.md / D1).
export async function signInWithGoogle(
  client: SupabaseClient,
): Promise<{ error: string | null }> {
  const redirectTo = makeRedirectUri({ scheme: "mentible", path: "auth-callback" });

  // `prompt: select_account` forces Google to show the account chooser every time,
  // instead of silently re-using an existing browser Google session — so after a
  // sign-out the next sign-in is a deliberate choice, not an automatic re-login.
  const queryParams = { prompt: "select_account" };

  if (Platform.OS === "web") {
    // Return to the current web app URL after OAuth, NOT Supabase's configured
    // Site URL (which would otherwise capture the redirect — e.g. localhost:3000).
    // detectSessionInUrl (lib/supabase, web-only) then exchanges the returned
    // ?code for a session. This origin+path must be allowlisted in Supabase →
    // Auth → URL Configuration → Redirect URLs (works for localhost:8081 and the
    // hosted /app/mentible/ alike).
    const redirectToWeb = `${window.location.origin}${window.location.pathname}`;
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { queryParams, redirectTo: redirectToWeb },
    });
    return { error: error?.message ?? null };
  }

  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: true, queryParams },
  });
  if (error) return { error: error.message };
  if (!data?.url) return { error: "Could not start Google sign-in." };

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  // User dismissed the browser (back / cancel) — not an error to surface loudly.
  if (result.type !== "success") return { error: null };

  const code = new URL(result.url).searchParams.get("code");
  if (!code) return { error: "Google sign-in did not complete. Please try again." };

  const { error: exchangeError } = await client.auth.exchangeCodeForSession(code);
  return { error: exchangeError?.message ?? null };
}
