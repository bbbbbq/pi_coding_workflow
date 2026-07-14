import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en";
import zhCN from "./locales/zh-CN";

export type SupportedLanguage = "en" | "zh-CN";

const storageKey = "pi-workflow.language";

function getInitialLanguage(): SupportedLanguage {
  const savedLanguage = window.localStorage.getItem(storageKey);
  if (savedLanguage === "en" || savedLanguage === "zh-CN") {
    return savedLanguage;
  }

  return window.navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

const initialLanguage = getInitialLanguage();
document.documentElement.lang = initialLanguage;

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    "zh-CN": { translation: zhCN },
  },
  lng: initialLanguage,
  fallbackLng: "en",
  supportedLngs: ["en", "zh-CN"],
  interpolation: {
    escapeValue: false,
  },
});

i18n.on("languageChanged", (language) => {
  const supportedLanguage: SupportedLanguage = language.startsWith("zh") ? "zh-CN" : "en";
  window.localStorage.setItem(storageKey, supportedLanguage);
  document.documentElement.lang = supportedLanguage;
});

export default i18n;
