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

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: string;
  initials: string;
  avatarColor: string;
  tenantId: string;
  tenantWide: boolean;
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
