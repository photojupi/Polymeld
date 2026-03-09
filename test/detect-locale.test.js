import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { detectLocale } from "../src/i18n/detect-locale.js";

// detectLocale()은 모듈 레벨 상태 없이 process.env를 런타임에 읽으므로
// 정적 import로 충분하다 (동적 import 캐시 우회 불필요).

describe("detectLocale — 환경변수 기반", () => {
  const envKeys = ["LC_ALL", "LC_MESSAGES", "LANG"];
  const savedEnv = {};

  before(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) process.env[key] = savedEnv[key];
      else delete process.env[key];
    }
  });

  function clearLocaleEnv() {
    for (const key of envKeys) {
      delete process.env[key];
    }
  }

  it("LANG=ko_KR.UTF-8 → 'ko'", () => {
    clearLocaleEnv();
    process.env.LANG = "ko_KR.UTF-8";
    assert.equal(detectLocale(), "ko");
  });

  it("LANG=ja_JP.UTF-8 → 'ja'", () => {
    clearLocaleEnv();
    process.env.LANG = "ja_JP.UTF-8";
    assert.equal(detectLocale(), "ja");
  });

  it("LANG=zh_CN.UTF-8 → 'zh-CN'", () => {
    clearLocaleEnv();
    process.env.LANG = "zh_CN.UTF-8";
    assert.equal(detectLocale(), "zh-CN");
  });

  it("LANG=zh_TW → 'zh-CN' (zh variants 통합)", () => {
    clearLocaleEnv();
    process.env.LANG = "zh_TW";
    assert.equal(detectLocale(), "zh-CN");
  });

  it("LC_ALL이 LANG보다 우선", () => {
    clearLocaleEnv();
    process.env.LC_ALL = "ja_JP.UTF-8";
    process.env.LANG = "ko_KR.UTF-8";
    assert.equal(detectLocale(), "ja");
  });

  it("LANG=C → 건너뜀 → Intl 폴백 또는 'en'", () => {
    clearLocaleEnv();
    process.env.LANG = "C";
    const result = detectLocale();
    assert.ok(["en", "ko", "ja", "zh-CN"].includes(result));
  });

  it("LANG=POSIX → 건너뜀", () => {
    clearLocaleEnv();
    process.env.LANG = "POSIX";
    const result = detectLocale();
    assert.ok(["en", "ko", "ja", "zh-CN"].includes(result));
  });

  it("미지원 로케일 fr_FR → Intl 폴백 또는 'en'", () => {
    clearLocaleEnv();
    process.env.LANG = "fr_FR.UTF-8";
    const result = detectLocale();
    assert.ok(["en", "ko", "ja", "zh-CN"].includes(result));
  });

  it("en_US → 'en'", () => {
    clearLocaleEnv();
    process.env.LANG = "en_US.UTF-8";
    assert.equal(detectLocale(), "en");
  });
});
