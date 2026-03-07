const SUPPORTED = ["en", "ko", "ja", "zh-CN"];

function normalizeLocale(raw) {
  if (!raw) return null;
  const base = raw.split(".")[0]; // "ko_KR.UTF-8" → "ko_KR"
  const normalized = base.replace("_", "-"); // "ko_KR" → "ko-KR"

  if (SUPPORTED.includes(normalized)) return normalized;

  // zh variants → zh-CN
  if (normalized.startsWith("zh")) return "zh-CN";

  // language code only: "ko-KR" → "ko"
  const lang = normalized.split("-")[0].toLowerCase();
  if (SUPPORTED.includes(lang)) return lang;

  return null;
}

export function detectLocale() {
  // 1. CLI flag: --lang <locale>
  const langIdx = process.argv.indexOf("--lang");
  if (langIdx !== -1 && process.argv[langIdx + 1]) {
    const locale = normalizeLocale(process.argv[langIdx + 1]);
    if (locale) return locale;
  }

  // 2. Environment variables (macOS/Linux)
  for (const key of ["LC_ALL", "LC_MESSAGES", "LANG"]) {
    const val = process.env[key];
    if (val && val !== "C" && val !== "POSIX") {
      const locale = normalizeLocale(val);
      if (locale) return locale;
    }
  }

  // 3. Intl API (Windows support)
  try {
    const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    const locale = normalizeLocale(intlLocale);
    if (locale) return locale;
  } catch { /* ignore */ }

  // 4. Fallback
  return "en";
}
