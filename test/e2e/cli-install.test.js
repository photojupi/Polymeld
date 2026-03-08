import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { isCliInstalled } from "../../src/config/loader.js";
import { initI18n } from "./_helpers.js";

before(async () => {
  await initI18n("ko");
});

// ─── Tier 1: 설치 확인 (API 비용 0) ──────────────────

describe("CLI 설치 확인", () => {
  it("claude CLI 설치됨", () => {
    assert.equal(isCliInstalled("claude"), true);
  });

  it("gemini CLI 설치됨", () => {
    assert.equal(isCliInstalled("gemini"), true);
  });

  it("codex CLI 설치됨", () => {
    assert.equal(isCliInstalled("codex"), true);
  });
});
