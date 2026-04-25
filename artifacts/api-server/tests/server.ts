import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import app from "../src/app";

export interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

/**
 * Boot the express app on an OS-assigned port and return the base URL. We
 * import `app` (not `index`) so the boot-time seed/insight/retention work in
 * `index.ts` stays out of the test process.
 */
export async function startTestServer(): Promise<TestServer> {
  const server: Server = await new Promise((resolve, reject) => {
    const s = app.listen(0, (err?: unknown) => {
      if (err) reject(err);
      else resolve(s);
    });
  });
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return {
    baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export interface AuthedClient {
  cookie: string;
  get(path: string): Promise<{ status: number; body: unknown }>;
  post(path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
  patch(path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
  put(path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
  delete(path: string): Promise<{ status: number; body: unknown }>;
}

/**
 * POST /api/auth/login and return an `AuthedClient` that re-uses the session
 * cookie for subsequent GETs. Throws when login fails so tests fail loudly
 * instead of silently producing 401s downstream.
 */
export async function loginClient(
  baseUrl: string,
  email: string,
  password: string,
): Promise<AuthedClient> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) {
    throw new Error(`login failed (${res.status}): ${await res.text()}`);
  }
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("login: no Set-Cookie returned");
  const cookie = setCookie.split(";")[0]!;
  const parse = async (r: Response) => {
    const text = await r.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // leave as text
    }
    return { status: r.status, body };
  };
  const send = (method: string) => async (path: string, body?: unknown) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        cookie,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return parse(r);
  };
  return {
    cookie,
    async get(path: string) {
      const r = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
      return parse(r);
    },
    post: send("POST"),
    patch: send("PATCH"),
    put: send("PUT"),
    delete: (path: string) => send("DELETE")(path),
  };
}
