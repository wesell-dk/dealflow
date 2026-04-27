import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import de from "../locales/de.json";
import en from "../locales/en.json";
import { apiUpdateProfilePreferences } from "./auth";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      de: { translation: de },
      en: { translation: en },
    },
    fallbackLng: "en",
    supportedLngs: ["de", "en"],
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage"],
      caches: ["localStorage"],
      lookupLocalStorage: "dealflow.lang",
    },
  });

export default i18n;

export interface SetLanguageOptions {
  /**
   * Wenn true (Default), wird die Sprache zusätzlich zum localStorage auch
   * still ans Backend (`PATCH /orgs/me/profile`) gespiegelt, damit sie
   * geräte-übergreifend gilt (Task #305). Aufrufer, die ohnehin schon
   * `apiUpdateProfilePreferences` aufrufen (z. B. der Profil-Editor),
   * sollten `persist: false` setzen, um die doppelte Anfrage zu vermeiden.
   */
  persist?: boolean;
}

export function setLanguage(lng: "de" | "en", opts: SetLanguageOptions = {}) {
  i18n.changeLanguage(lng);
  try {
    localStorage.setItem("dealflow.lang", lng);
  } catch {}
  // Fire-and-forget: Wenn der Nutzer eingeloggt ist, persistieren wir die
  // Wahl serverseitig, damit sie beim nächsten Login auf einem anderen
  // Gerät erhalten bleibt. Fehler (z. B. 401, kein Netz) bewusst still
  // schlucken — die lokale Sprache ist bereits umgeschaltet.
  if (opts.persist !== false) {
    void apiUpdateProfilePreferences({ preferredLanguage: lng }).catch(() => {
      /* ignore */
    });
  }
}
