import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initI18n, t, currentLanguage } from "../src/i18n/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.join(__dirname, "../src/i18n/locales");

function loadLocale(name) {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, name), "utf-8"));
}

/** 중첩 JSON에서 모든 리프 키를 플랫한 dot-notation 배열로 추출 */
function flatKeys(obj, prefix = "") {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      keys.push(...flatKeys(v, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

// ─── 번역 키 동기화 ─────────────────────────────────

describe("i18n 번역 키 동기화", () => {
  const en = loadLocale("en.json");
  const ko = loadLocale("ko.json");
  const ja = loadLocale("ja.json");
  const zhCN = loadLocale("zh-CN.json");

  const enKeys = flatKeys(en).sort();
  const koKeys = flatKeys(ko).sort();
  const jaKeys = flatKeys(ja).sort();
  const zhCNKeys = flatKeys(zhCN).sort();

  it("ko.json은 en.json과 동일한 키를 가짐", () => {
    const missingInKo = enKeys.filter((k) => !koKeys.includes(k));
    const extraInKo = koKeys.filter((k) => !enKeys.includes(k));

    assert.deepEqual(missingInKo, [], `ko.json에 없는 키: ${missingInKo.join(", ")}`);
    assert.deepEqual(extraInKo, [], `ko.json에만 있는 키: ${extraInKo.join(", ")}`);
  });

  it("ja.json은 en.json과 동일한 키를 가짐", () => {
    const missingInJa = enKeys.filter((k) => !jaKeys.includes(k));
    const extraInJa = jaKeys.filter((k) => !enKeys.includes(k));

    assert.deepEqual(missingInJa, [], `ja.json에 없는 키: ${missingInJa.join(", ")}`);
    assert.deepEqual(extraInJa, [], `ja.json에만 있는 키: ${extraInJa.join(", ")}`);
  });

  it("zh-CN.json은 en.json과 동일한 키를 가짐", () => {
    const missingInZh = enKeys.filter((k) => !zhCNKeys.includes(k));
    const extraInZh = zhCNKeys.filter((k) => !enKeys.includes(k));

    assert.deepEqual(missingInZh, [], `zh-CN.json에 없는 키: ${missingInZh.join(", ")}`);
    assert.deepEqual(extraInZh, [], `zh-CN.json에만 있는 키: ${extraInZh.join(", ")}`);
  });

  it("모든 번역 값이 비어있지 않음 (en)", () => {
    const emptyKeys = enKeys.filter((k) => {
      const val = k.split(".").reduce((o, p) => o?.[p], en);
      return val === "" || val === null || val === undefined;
    });
    assert.deepEqual(emptyKeys, [], `빈 값을 가진 키: ${emptyKeys.join(", ")}`);
  });
});

// ─── i18n 초기화 ────────────────────────────────────

describe("i18n 초기화", () => {
  it("한국어로 초기화 시 t()가 한국어 반환", async () => {
    await initI18n("ko");
    assert.equal(currentLanguage(), "ko");
    // 실제 번역 값이 한국어인지 확인
    const result = t("common.error");
    assert.equal(result, "에러");
  });

  it("영어로 초기화 시 t()가 영어 반환", async () => {
    await initI18n("en");
    assert.equal(currentLanguage(), "en");
    const result = t("common.error");
    assert.equal(result, "Error");
  });

  it("일본어로 초기화 시 t()가 일본어 반환", async () => {
    await initI18n("ja");
    assert.equal(currentLanguage(), "ja");
    const result = t("common.error");
    assert.equal(result, "エラー");
  });

  it("중국어로 초기화 시 t()가 중국어 반환", async () => {
    await initI18n("zh-CN");
    assert.equal(currentLanguage(), "zh-CN");
    const result = t("common.error");
    assert.equal(result, "错误");
  });

  it("지원하지 않는 언어면 영어 폴백", async () => {
    await initI18n("fr");
    // 지원하지 않는 언어여도 fallback으로 영어가 반환됨
    const result = t("common.error");
    assert.equal(result, "Error");
  });

  it("보간(interpolation)이 정상 동작", async () => {
    await initI18n("ko");
    const result = t("cli.run.interactionMode", { mode: "semi-auto" });
    assert.ok(result.includes("semi-auto"), `보간 결과에 변수가 포함되어야 함: ${result}`);
  });
});
