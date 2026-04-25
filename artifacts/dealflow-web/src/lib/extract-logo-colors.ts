/**
 * Lädt eine Logo-Datei in einen Off-Screen-Canvas, sampelt Pixel und liefert
 * eine vorgeschlagene Primär-/Sekundärfarbe.
 *
 * - Transparente Pixel werden ignoriert.
 * - Fast-weiße/fast-schwarze Pixel werden stark heruntergewichtet (Logos haben
 *   meist viel Hintergrund-Weiß, das nicht die Brand-Farbe ist).
 * - Sekundärfarbe wird so gewählt, dass sie vom Primär klar unterscheidbar ist.
 *
 * Liefert null, wenn das Bild nicht decodierbar ist oder keine relevante Farbe
 * enthält.
 */
export type ExtractedColors = { primary: string; secondary: string | null };

/**
 * Helligkeit (Y aus YIQ) eines Hex-Farbwertes, normalisiert auf 0..1.
 * Wird benutzt, um zu warnen wenn die Primärfarbe so hell ist, dass sie
 * auf weißem Papier (DIN A4) untergeht — und um automatisch eine lesbare
 * Vordergrundfarbe zu wählen.
 */
export function colorLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 1; // unbekannt → defensiv "hell" annehmen
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Wählt eine lesbare Vordergrundfarbe (Schwarz oder Weiß) für einen
 * gegebenen Hintergrund-Hex. Schwellwert 0.6 hat sich bewährt.
 */
export function foregroundFor(bgHex: string): string {
  return colorLuminance(bgHex) > 0.6 ? "#0f172a" : "#ffffff";
}

/**
 * True, wenn die Farbe auf weißem Papier praktisch unsichtbar wäre.
 * Wir warnen ab Luminanz > 0.92 — also nahezu Weiß.
 */
export function isTooLightForPaper(hex: string): boolean {
  return colorLuminance(hex) > 0.92;
}

export async function extractLogoColors(file: File): Promise<ExtractedColors | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const w = 96;
    const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w)) || 96;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(0, 0, w, h).data;
    } catch {
      // Tainted canvas (sollte mit Blob-URL nicht passieren, aber sicher ist sicher).
      return null;
    }

    // Bucketing: 5 Bit pro Kanal → 32^3 = 32768 Buckets.
    const buckets = new Map<number, number>();
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 128) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      // Sättigung approximieren: max-min im RGB-Raum.
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      // Weight: weniger Gewicht für nahe-weiß/schwarz und für unsaturierte Farben.
      let weight = 1;
      if (lum > 240 || lum < 12) weight = 0.05;
      else if (sat < 0.12) weight = 0.25;
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      buckets.set(key, (buckets.get(key) ?? 0) + weight);
    }
    if (buckets.size === 0) return null;
    const ranked = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
    const primaryKey = ranked[0][0];
    const primary = bucketToHex(primaryKey);
    let secondary: string | null = null;
    for (let i = 1; i < ranked.length && i < 24; i++) {
      if (bucketDistance(ranked[i][0], primaryKey) >= 8) {
        secondary = bucketToHex(ranked[i][0]);
        break;
      }
    }
    return { primary, secondary };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = url;
  });
}

function bucketToHex(k: number): string {
  const r = ((k >> 10) & 31) << 3;
  const g = ((k >> 5) & 31) << 3;
  const b = (k & 31) << 3;
  return (
    "#" +
    [r, g, b]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

function bucketDistance(a: number, b: number): number {
  const ar = (a >> 10) & 31;
  const ag = (a >> 5) & 31;
  const ab = a & 31;
  const br = (b >> 10) & 31;
  const bg = (b >> 5) & 31;
  const bb = b & 31;
  return Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb);
}
