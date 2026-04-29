/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Absolute Origin der DealFlow-API (z. B. "https://dealflow.returnz.one").
   * Wird beim Build per ENV gesetzt und sorgt dafür, dass die SPA auch dann
   * die richtige API erreicht, wenn sie aus einem Cross-Origin-iframe
   * (z. B. der Beta-Test-Plattform) heraus geladen wird.
   *
   * Leer/unset → relative Pfade (Standard, funktioniert auf eigener Domain).
   */
  readonly VITE_API_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
