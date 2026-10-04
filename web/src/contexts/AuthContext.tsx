import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

export interface AuthUser {
  sub: string;
  email: string;
  email_verified?: boolean;
}

function mapSupabaseUser(user: User | null): AuthUser | null {
  if (!user) return null;
  return {
    sub: user.id,
    email: user.email || "",
    email_verified: user.email_confirmed_at !== null,
  };
}

export interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  isGuest: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signAsGuest: () => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load token from localStorage + check Supabase session on mount
  useEffect(() => {
    const initAuth = async () => {
      try {
        // Check for guest token first
        const guestToken = localStorage.getItem("sb-mentible-app-guest-token");
        if (guestToken) {
          setToken(guestToken);
          setIsGuest(true);
          return;
        }

        // Check for stored Supabase token + user
        const storedToken = localStorage.getItem("sb-mentible-app-auth-token");
        const storedUser = localStorage.getItem("sb-mentible-app-user");
        if (storedToken && storedUser) {
          try {
            setToken(storedToken);
            setUser(JSON.parse(storedUser));
            return;
          } catch {
            localStorage.removeItem("sb-mentible-app-auth-token");
            localStorage.removeItem("sb-mentible-app-user");
          }
        }

        // Check Supabase session (handles refresh token)
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        if (data.session) {
          const mappedUser = mapSupabaseUser(data.session.user);
          setToken(data.session.access_token);
          setUser(mappedUser);
          localStorage.setItem("sb-mentible-app-auth-token", data.session.access_token);
          if (mappedUser) {
            localStorage.setItem("sb-mentible-app-user", JSON.stringify(mappedUser));
          }
        }
      } catch (e) {
        console.error("Auth init error:", e);
        // Continue without token on error
      } finally {
        setLoading(false);
      }
    };
    initAuth();
  }, []);

  const signIn = async (email: string, password: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      if (!data.session) throw new Error("No session returned");

      const mappedUser = mapSupabaseUser(data.user);
      setToken(data.session.access_token);
      setUser(mappedUser);

      localStorage.setItem("sb-mentible-app-auth-token", data.session.access_token);
      if (mappedUser) {
        localStorage.setItem("sb-mentible-app-user", JSON.stringify(mappedUser));
      }
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
    } finally {
      setLoading(false);
    }
  };

  const signAsGuest = () => {
    const guestToken = `guest_${Date.now()}`;
    setToken(guestToken);
    setUser(null);
    setIsGuest(true);
    localStorage.setItem("sb-mentible-app-guest-token", guestToken);
  };

  const signOut = async () => {
    try {
      if (!isGuest) {
        await supabase.auth.signOut();
      }
    } catch (e) {
      console.error("Sign out error:", e);
    }
    setToken(null);
    setUser(null);
    setIsGuest(false);
    localStorage.removeItem("sb-mentible-app-auth-token");
    localStorage.removeItem("sb-mentible-app-user");
    localStorage.removeItem("sb-mentible-app-guest-token");
  };

  return (
    <AuthContext.Provider
      value={{ user, token, loading, isGuest, signIn, signInWithGoogle, signAsGuest, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
