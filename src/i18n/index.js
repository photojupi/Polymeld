import i18next from "i18next";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { detectLocale } from "./detect-locale.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadJSON(filename) {
  const filePath = path.join(__dirname, "locales", filename);
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export async function initI18n(overrideLng) {
  const lng = overrideLng || detectLocale();

  await i18next.init({
    lng,
    fallbackLng: "en",
    showSupportNotice: false,
    interpolation: { escapeValue: false },
    resources: {
      en: { translation: loadJSON("en.json") },
      ko: { translation: loadJSON("ko.json") },
      ja: { translation: loadJSON("ja.json") },
      "zh-CN": { translation: loadJSON("zh-CN.json") },
    },
  });
}

export const t = (...args) => i18next.t(...args);
export const currentLanguage = () => i18next.language;
