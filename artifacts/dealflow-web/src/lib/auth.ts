export interface AllowedScope {
  tenantWide: boolean;
  companyIds: string[];
  brandIds: string[];
}

export interface ActiveScope {
  companyIds: string[] | null;
  brandIds: string[] | null;
  filtered: boolean;
}

const ACTIVE_SCOPE_COOKIE = "df_active_scope";

/**
 * Liest den vom Server gespiegelten Active-Scope-Cookie (df_active_scope).
 * Wird beim App-Boot SOFORT (synchron) gelesen, bevor /auth/me antwortet,
 * damit der ScopeSwitcher und Folge-Queries keinen "tenantWide-Flash" zeigen.
 */
export function readActiveScopeCookie(): ActiveScope | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${ACTIVE_SCOPE_COOKIE}=`));
  if (!match) return null;
  try {
    const raw = decodeURIComponent(match.split("=")[1] ?? "");
    const parsed = JSON.parse(raw) as { companyIds?: string[] | null; brandIds?: string[] | null };
    const companyIds = parsed.companyIds ?? null;
    const brandIds = parsed.brandIds ?? null;
    return {
      companyIds,
      brandIds,
      filtered: companyIds !== null || brandIds !== null,
    };
  } catch {
    return null;
  }
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: string;
  initials: string;
  avatarColor: string;
  tenantId: string;
  tenantWide: boolean;
  isPlatformAdmin?: boolean;
  companyIds: string[];
  brandIds: string[];
  allowedScope: AllowedScope;
  activeScope: ActiveScope;
}

export async function apiUpdateActiveScope(input: {
  companyIds: string[] | null;
  brandIds: string[] | null;
}): Promise<{ activeScope: ActiveScope; allowedScope: AllowedScope }> {
  const r = await fetch(`${API_BASE}/orgs/me/active-scope`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Scope-Update fehlgeschlagen");
  }
  return (await r.json()) as { activeScope: ActiveScope; allowedScope: AllowedScope };
}

const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

export async function apiLogin(email: string, password: string): Promise<CurrentUser> {
  const r = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Login fehlgeschlagen");
  }
  const data = (await r.json()) as { user: CurrentUser };
  return data.user;
}

export async function apiLogout(): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

export async function apiMe(): Promise<CurrentUser | null> {
  const r = await fetch(`${API_BASE}/auth/me`, { credentials: "include" });
  if (r.status === 401) return null;
  if (!r.ok) return null;
  const data = (await r.json()) as { user: CurrentUser };
  return data.user;
}
