import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, apiLogin, apiLogout, apiMe, apiUpdateMe } from "./api";
import type { AuthUser } from "./types";

interface AuthValue {
  user: AuthUser | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  updateAccount(input: { name: string; email: string; currentPassword?: string; newPassword?: string }): Promise<AuthUser>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiMe().then(setUser).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => setUser(null);
    window.addEventListener("sprintforge:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("sprintforge:unauthorized", handleUnauthorized);
  }, []);

  const value = useMemo<AuthValue>(() => ({
    user,
    loading,
    async login(email, password) {
      setUser(await apiLogin(email, password));
    },
    async logout() {
      try {
        await apiLogout();
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 401)) throw error;
      } finally {
        setUser(null);
      }
    },
    async updateAccount(input) {
      const updated = await apiUpdateMe(input);
      setUser(updated);
      return updated;
    },
  }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
