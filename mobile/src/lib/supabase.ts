import "react-native-url-polyfill/auto"; // RN has no global URL — Supabase needs it
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { largeSecureStore } from "@/secure/largeSecureStore";

// Supabase project config (ADR-014 D1, O1). Public client-side values; set them in
// the app env to enable login. Unset → identity disabled (the anonymous demo),
// `supabase` is null and the app runs accountless — never a crash.
const url = process.env["EXPO_PUBLIC_SUPABASE_URL"] ?? "";
const anonKey = process.env["EXPO_PUBLIC_SUPABASE_ANON_KEY"] ?? "";

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        storage: largeSecureStore, // encrypted, secure-store-protected (D1)
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false, // no URL-based session pickup on native
      },
    })
  : null;
