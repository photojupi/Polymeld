import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { isCliInstalled } from "../../src/config/loader.js";
import { runCli, createTestAdapter, initI18n } from "./_helpers.js";

before(async () => {
  await initI18n("ko");
});

const adapter = createTestAdapter();
const claudeOk = isCliInstalled("claude");
const geminiOk = isCliInstalled("gemini");
const codexOk = isCliInstalled("codex");

// ─── Tier 3: 실제 코드 생성 (CLI 그룹 간 병렬 실행) ───

describe("코드 생성 E2E", { concurrency: true }, () => {

  describe("Claude 코드 생성", { skip: !claudeOk, concurrency: false }, () => {
    let raw;

    it("간단한 프롬프트에 응답", { timeout: 60000 }, async () => {
      raw = await runCli(
        "claude",
        ["-p", "--output-format", "text", "--max-turns", "1", "--effort", "low"],
        "1+1의 결과를 숫자만 답해"
      );
      assert.ok(raw.length > 0, "응답이 비어있음");
    });

    it("출력 정규화 후 ANSI 코드 없음", () => {
      assert.ok(raw, "이전 테스트에서 응답을 받지 못함");
      const clean = adapter._normalizeOutput(raw, "claude");
      assert.ok(clean.length > 0, "정규화 후 빈 문자열");
      // eslint-disable-next-line no-control-regex
      assert.ok(!/[\u001b\u009b]/.test(clean), "ANSI 코드가 남아있음");
    });
  });

  describe("Gemini 코드 생성", { skip: !geminiOk, concurrency: false }, () => {
    let raw;

    it("간단한 프롬프트에 응답", { timeout: 60000 }, async () => {
      raw = await runCli(
        "gemini",
        ["--output-format", "text"],
        "1+1의 결과를 숫자만 답해"
      );
      assert.ok(raw.length > 0, "응답이 비어있음");
    });

    it("출력 정규화 후 구분선 없음", () => {
      assert.ok(raw, "이전 테스트에서 응답을 받지 못함");
      const clean = adapter._normalizeOutput(raw, "gemini");
      assert.ok(clean.length > 0, "정규화 후 빈 문자열");
      assert.ok(!/^[━─]+$/m.test(clean), "구분선이 남아있음");
    });
  });

  describe("Codex 코드 생성", { skip: !codexOk, concurrency: false }, () => {
    let raw;

    it("간단한 프롬프트에 응답", { timeout: 60000 }, async () => {
      raw = await runCli(
        "codex",
        ["exec", "--skip-git-repo-check", "--full-auto"],
        "1+1의 결과를 숫자만 답해"
      );
      assert.ok(raw.length > 0, "응답이 비어있음");
    });

    it("출력 정규화 후 TUI 잡음 없음", () => {
      assert.ok(raw, "이전 테스트에서 응답을 받지 못함");
      const clean = adapter._normalizeOutput(raw, "codex");
      assert.ok(clean.length > 0, "정규화 후 빈 문자열");
      assert.ok(!/^(Thinking|Executing|Reading).*$/m.test(clean), "TUI 잡음이 남아있음");
    });
  });

});
