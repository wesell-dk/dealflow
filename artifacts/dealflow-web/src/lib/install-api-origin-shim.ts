// Cross-Origin-iframe-Shim für API-Calls.
//
// Hintergrund: die SPA wird auch über die Beta-Test-Plattform betahub.returnz.one
// in einem iframe ausgeliefert (`<iframe src="https://betahub.returnz.one/api/apps/.../embed-proxy/...">`).
// Innerhalb dieses iframes ist die Document-Origin betahub, nicht dealflow.
// Ein relativer `fetch("/api/auth/login")` würde dadurch an betahub gehen
// (→ 404), weil betahub die DealFlow-API-Routen nicht kennt.
//
// Lösung: wenn beim Build `VITE_API_ORIGIN` gesetzt ist und nicht zur
// aktuellen Window-Origin passt, hängen wir vor jeden same-origin /api-Pfad
// transparent die konfigurierte API-Origin. Cookies (SameSite=None;Secure)
// und CORS (origin echo + credentials) sind serverseitig dafür schon
// vorbereitet.
//
// Wird die SPA direkt unter ihrer eigenen Domain (dealflow.returnz.one)
// geladen, passt window.origin === API_ORIGIN — der Shim ist dann ein No-op.

const RAW_ORIGIN = import.meta.env.VITE_API_ORIGIN;
const TARGET_ORIGIN = (RAW_ORIGIN ?? "").trim().replace(/\/$/, "");
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API_PREFIX = `${BASE}/api`;

function shouldRewritePathname(pathname: string): boolean {
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
}

function rewriteString(urlStr: string): string {
  // Schema-relative oder absolute URLs bleiben unverändert.
  if (/^[a-z][a-z0-9+.-]*:/i.test(urlStr) || urlStr.startsWith("//")) {
    return urlStr;
  }
  // Relative Pfade ohne führendes "/" auch nicht anfassen
  // (sind nicht unsere API).
  if (!urlStr.startsWith("/")) return urlStr;
  // Pfad + Query trennen, damit startsWith zuverlässig ist.
  const qIdx = urlStr.indexOf("?");
  const pathname = qIdx >= 0 ? urlStr.slice(0, qIdx) : urlStr;
  if (!shouldRewritePathname(pathname)) return urlStr;
  return `${TARGET_ORIGIN}${urlStr}`;
}

function rewriteUrl(u: URL): string {
  if (u.origin !== window.location.origin) return u.toString();
  if (!shouldRewritePathname(u.pathname)) return u.toString();
  return `${TARGET_ORIGIN}${u.pathname}${u.search}${u.hash}`;
}

export function installApiOriginShim(): void {
  if (typeof window === "undefined") return;
  if (!TARGET_ORIGIN) return;
  if (window.location.origin === TARGET_ORIGIN) return;

  const realFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (typeof input === "string") {
      return realFetch(rewriteString(input), init);
    }
    if (input instanceof URL) {
      return realFetch(rewriteUrl(input), init);
    }
    // Request-Objekt: ggf. mit umgeschriebener URL neu bauen.
    try {
      const reqUrl = new URL(input.url, window.location.href);
      if (reqUrl.origin === window.location.origin && shouldRewritePathname(reqUrl.pathname)) {
        const newUrl = `${TARGET_ORIGIN}${reqUrl.pathname}${reqUrl.search}${reqUrl.hash}`;
        return realFetch(new Request(newUrl, input), init);
      }
    } catch {
      // input.url unparsebar → unverändert weitergeben.
    }
    return realFetch(input, init);
  };
}
