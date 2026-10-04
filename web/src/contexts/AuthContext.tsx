import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export interface AuthUser {
  sub: string;
  email: string;
  email_verified?: boolean;
}

export interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load token from localStorage on mount
  useEffect(() => {
    const storedToken = localStorage.getItem("sb-mentible-app-auth-token");
    const storedUser = localStorage.getItem("sb-mentible-app-user");
    if (storedToken && storedUser) {
      try {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      } catch {
        // Invalid stored data, clear
        localStorage.removeItem("sb-mentible-app-auth-token");
        localStorage.removeItem("sb-mentible-app-user");
      }
    }
    setLoading(false);
  }, []);

  const signIn = async (email: string, password: string) => {
    setLoading(true);
    try {
      // TODO: Replace with actual Supabase auth call
      // This is a placeholder that simulates login
      const mockToken = `mock-token-${Date.now()}`;
      const mockUser: AuthUser = {
        sub: `user-${Date.now()}`,
        email,
        email_verified: true,
      };
      setToken(mockToken);
      setUser(mockUser);
      localStorage.setItem("sb-mentible-app-auth-token", mockToken);
      localStorage.setItem("sb-mentible-app-user", JSON.stringify(mockUser));
    } finally {
      setLoading(false);
    }
  };

  const signOut = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem("sb-mentible-app-auth-token");
    localStorage.removeItem("sb-mentible-app-user");
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, signIn, signOut }}>
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
