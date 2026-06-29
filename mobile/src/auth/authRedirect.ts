import { Platform } from "react-native";
import { makeRedirectUri } from "expo-auth-session";

/**
 * Where Supabase should send a user back after they click an email
 * confirmation or password-reset link.
 *
 * On web this is the current app URL — the same origin+path the SPA is served
 * from (e.g. `https://mambakkam.net/app/mentible`) — so the web client's
 * `detectSessionInUrl` can exchange the returned `?code` for a session. On
 * native it's the `mentible://auth-callback` deep link.
 *
 * Without an explicit redirect, Supabase falls back to the dashboard "Site
 * URL", which is NOT the app — it sends users to whatever page is configured
 * there (for us, the bare `mambakkam.net` homepage) with a dangling `?code`
 * that nothing exchanges, so login never completes. Mirrors the redirect logic
 * in `googleSignIn.ts`. The returned URL must be allowlisted in Supabase →
 * Auth → URL Configuration → Redirect URLs.
 */
export function authRedirectUrl(): string {
  if (Platform.OS === "web") {
    return `${window.location.origin}${window.location.pathname}`;
  }
  return makeRedirectUri({ scheme: "mentible", path: "auth-callback" });
}
