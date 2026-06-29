import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react-native";

// Mock the Supabase client so useAuth's delegation + state machine are tested
// without a live project. (The client wiring itself is verified on-device.)
// The factory must be self-contained — jest hoists it above imports.
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: jest
        .fn()
        .mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } }),
      signInWithPassword: jest.fn().mockResolvedValue({ error: null }),
      signUp: jest.fn().mockResolvedValue({ error: null }),
      resetPasswordForEmail: jest.fn().mockResolvedValue({ error: null }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
    },
  },
}));

// The Google OAuth flow pulls native modules (expo-web-browser); it's unit-tested
// separately. Here we only assert the provider delegates to it.
jest.mock("@/auth/googleSignIn", () => ({
  signInWithGoogle: jest.fn().mockResolvedValue({ error: null }),
}));

// Avoid pulling expo-auth-session / window into the unit test; the redirect URL
// derivation is incidental here — we only assert it is threaded through.
jest.mock("@/auth/authRedirect", () => ({
  authRedirectUrl: () => "https://app.example/app/mentible",
}));

import { supabase } from "@/lib/supabase";
import { signInWithGoogle } from "@/auth/googleSignIn";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";

// The mocked auth namespace (jest.fns).
const auth = (supabase as unknown as { auth: Record<string, jest.Mock> }).auth;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe("useAuth", () => {
  it("resolves to signed_out when there is no session", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("signed_out"));
    expect(result.current.accessToken).toBeNull();
  });

  it("signIn delegates to supabase.auth.signInWithPassword", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.signIn("a@x.com", "pw");
    });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "a@x.com", password: "pw" });
  });

  it("signUp passes emailRedirectTo so the confirmation link returns to the app", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.signUp("a@x.com", "pw");
    });
    expect(auth.signUp).toHaveBeenCalledWith({
      email: "a@x.com",
      password: "pw",
      options: { emailRedirectTo: "https://app.example/app/mentible" },
    });
  });

  it("resetPassword passes redirectTo so the reset link returns to the app", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.resetPassword("a@x.com");
    });
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("a@x.com", {
      redirectTo: "https://app.example/app/mentible",
    });
  });

  it("signInWithGoogle delegates to the Google OAuth flow with the client", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.signInWithGoogle();
    });
    expect(signInWithGoogle).toHaveBeenCalledWith(supabase);
  });

  it("signOut delegates to supabase.auth.signOut", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.signOut();
    });
    expect(auth.signOut).toHaveBeenCalled();
  });

  it("surfaces a sign-in error message", async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ error: { message: "Invalid login" } });
    const { result } = renderHook(() => useAuth(), { wrapper });
    let res: { error: string | null } = { error: null };
    await act(async () => {
      res = await result.current.signIn("a@x.com", "bad");
    });
    expect(res.error).toBe("Invalid login");
  });
});
