import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {
  apiLogin,
  apiLogout,
  apiMe,
  readActiveScopeCookie,
  type ActiveScope,
  type CurrentUser,
} from "@/lib/auth";

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  /**
   * Active-Scope-Snapshot aus dem Cookie, der SOFORT beim ersten Render
   * verfügbar ist (vor /auth/me). Verhindert "tenantWide-Flash" im
   * ScopeSwitcher und ähnlichen scope-bewussten UI-Teilen.
   */
  bootActiveScope: ActiveScope | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  // Lazy init: synchron beim ersten Render, kein Round-trip nötig.
  const [bootActiveScope] = useState<ActiveScope | null>(() => readActiveScopeCookie());

  const refresh = async () => {
    const u = await apiMe();
    setUser(u);
  };

  useEffect(() => {
    void (async () => {
      await refresh();
      setLoading(false);
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const u = await apiLogin(email, password);
    setUser(u);
  };

  const logout = async () => {
    await apiLogout();
    setUser(null);
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    window.location.assign(`${base}/login`);
  };

  return (
    <AuthCtx.Provider value={{ user, loading, bootActiveScope, login, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(AuthCtx);
  if (!v) throw new Error("useAuth must be inside <AuthProvider>");
  return v;
}
