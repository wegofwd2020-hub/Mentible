import "react-native-url-polyfill/auto"; // RN has no global URL — Supabase needs it
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { largeSecureStore } from "@/secure/largeSecureStore";

// expo-secure-store is native-only. On web there's no hardware secure store, so
// fall back to AsyncStorage (localStorage); on native, the encrypted LargeSecureStore
// (ADR-014 D1). Web is a dev-preview convenience — the product target is native.
const authStorage = Platform.OS === "web" ? AsyncStorage : largeSecureStore;

// Supabase project config (ADR-014 D1, O1). Public client-side values; set them in
// the app env to enable login. Unset → identity disabled (the anonymous demo),
// `supabase` is null and the app runs accountless — never a crash.
const url = process.env["EXPO_PUBLIC_SUPABASE_URL"] ?? "";
const anonKey = process.env["EXPO_PUBLIC_SUPABASE_ANON_KEY"] ?? "";

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        storage: authStorage, // native: encrypted secure-store (D1); web: localStorage
        autoRefreshToken: true,
        persistSession: true,
        // PKCE so the OAuth code→session exchange (Google sign-in) works; it also
        // stores the code verifier in `authStorage`, so it never leaves the device.
        flowType: "pkce",
        // Native opens the OAuth result in an auth session and exchanges the code
        // explicitly (see auth/googleSignIn). Only web returns to a URL we parse.
        detectSessionInUrl: Platform.OS === "web",
      },
    })
  : null;
