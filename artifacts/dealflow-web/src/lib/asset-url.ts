// Wandelt einen gespeicherten Logo-/Asset-Pfad in eine im Browser ladbare URL um.
//
// Hintergrund: Backend speichert/serviert Logos unter mehreren Pfad-Varianten:
//   - "/objects/<key>"         (kanonisch)
//   - "/storage/objects/<key>"
//   - "/api/storage/objects/<key>"
// Der Vite-Dev-Server bzw. Replit-Proxy hängt aber die Artifact-Base-URL voran
// (z. B. `/artifacts/dealflow-web/`). Ein `<img src="/api/storage/objects/…">`
// landet sonst am Root-Origin und liefert 404.
//
// Diese Funktion macht aus einem beliebigen Logo-Pfad immer eine relative URL
// inklusive Artifact-BASE_URL. Externe https-URLs und data-URIs werden
// unverändert durchgereicht.
const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export function toAssetSrc(input: string | null | undefined): string {
  if (!input) return "";
  const v = input.trim();
  if (!v) return "";
  if (v.startsWith("data:")) return v;
  if (/^https?:\/\//i.test(v)) return v;

  // Normalisiere alle Storage-Varianten auf "/api/storage/objects/<key>"
  // — das ist die im API-Server registrierte Route (akzeptiert auch /storage/...
  // und /objects/... als Aliase, aber dieser Pfad funktioniert garantiert).
  let path = v;
  if (path.startsWith("/api/storage/")) {
    path = path.slice("/api/storage".length); // → "/objects/..."
  } else if (path.startsWith("/storage/")) {
    path = path.slice("/storage".length); // → "/objects/..."
  }
  if (!path.startsWith("/")) path = `/${path}`;
  if (!path.startsWith("/objects/")) {
    // Unbekanntes Schema — dann besser unverändert lassen, aber mit BASE prefix.
    return `${BASE}${path}`;
  }
  return `${BASE}/api/storage${path}`;
}
