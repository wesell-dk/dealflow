import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import de from "../locales/de.json";
import en from "../locales/en.json";

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

export function setLanguage(lng: "de" | "en") {
  i18n.changeLanguage(lng);
  try {
    localStorage.setItem("dealflow.lang", lng);
  } catch {}
}
