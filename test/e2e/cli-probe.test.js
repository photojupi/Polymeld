import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { isCliInstalled, probeCliAuth } from "../../src/config/loader.js";
import { initI18n } from "./_helpers.js";

before(async () => {
  await initI18n("ko");
});

const claudeOk = isCliInstalled("claude");
const geminiOk = isCliInstalled("gemini");
const codexOk = isCliInstalled("codex");
const allInstalled = claudeOk && geminiOk && codexOk;

// ─── Tier 2: 인증 프로브 (최소 API 비용, 병렬 실행) ────

describe("CLI 인증 프로브", { skip: !allInstalled, concurrency: true }, () => {
  it("claude 프로브 성공", { timeout: 60000 }, async () => {
    const result = await probeCliAuth("claude");
    assert.equal(result.ok, true, `claude 프로브 실패: ${result.reason}`);
  });

  it("gemini 프로브 성공", { timeout: 60000 }, async () => {
    const result = await probeCliAuth("gemini");
    assert.equal(result.ok, true, `gemini 프로브 실패: ${result.reason}`);
  });

  it("codex 프로브 성공", { timeout: 60000 }, async () => {
    const result = await probeCliAuth("codex");
    assert.equal(result.ok, true, `codex 프로브 실패: ${result.reason}`);
  });
});
