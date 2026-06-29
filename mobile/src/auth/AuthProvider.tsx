import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { signInWithGoogle as signInWithGoogleFlow } from "@/auth/googleSignIn";
import { authRedirectUrl } from "@/auth/authRedirect";

// Auth surface for the app (ADR-014 D1). Wraps Supabase auth; the rest of the app
// depends only on this contract (session + sign in/up/out), never on Supabase
// directly. When Supabase isn't configured, status is "unavailable" and the app
// runs accountless (the anonymous demo) — sign-in is simply disabled.
export type AuthStatus = "loading" | "signed_in" | "signed_out" | "unavailable";

export interface AuthValue {
  status: AuthStatus;
  session: Session | null;
  // The IdP access token for backend calls (Bearer). OUR session JWT, never a key.
  accessToken: string | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  // OAuth sign-in via the IdP (Google). Opens the system browser; resolves once the
  // session is set (or with an error). Cancellation resolves with error: null.
  signInWithGoogle: () => Promise<{ error: string | null }>;
  // Triggers Supabase's password-reset email (the IdP owns the reset flow, D1).
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>(supabase ? "loading" : "unavailable");

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setStatus(data.session ? "signed_in" : "signed_out");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setStatus(next ? "signed_in" : "signed_out");
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      session,
      accessToken: session?.access_token ?? null,
      signIn: async (email, password) => {
        if (!supabase) return { error: "Sign-in is not available." };
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error: error?.message ?? null };
      },
      signUp: async (email, password) => {
        if (!supabase) return { error: "Sign-up is not available." };
        // emailRedirectTo routes the confirmation link back to the app (not the
        // dashboard Site URL — the bare homepage), so detectSessionInUrl can
        // exchange the ?code on return.
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: authRedirectUrl() },
        });
        return { error: error?.message ?? null };
      },
      signInWithGoogle: async () => {
        if (!supabase) return { error: "Sign-in is not available." };
        return signInWithGoogleFlow(supabase);
      },
      resetPassword: async (email) => {
        if (!supabase) return { error: "Password reset is not available." };
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: authRedirectUrl(),
        });
        return { error: error?.message ?? null };
      },
      signOut: async () => {
        await supabase?.auth.signOut();
      },
    }),
    [status, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
