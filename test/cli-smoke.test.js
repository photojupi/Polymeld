import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import crossSpawn from "cross-spawn";
import { isCliInstalled, probeCliAuth } from "../src/config/loader.js";
import { ModelAdapter } from "../src/models/adapter.js";
import { initI18n } from "../src/i18n/index.js";

before(async () => {
  await initI18n("ko");
});

// ─── 헬퍼 ────────────────────────────────────────────

/** CLI를 직접 실행하고 stdout을 반환 (타임아웃 60초) */
function runCli(command, args, stdin, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE; // Claude 중첩 세션 방지

    const proc = crossSpawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`${command} 타임아웃 (${timeoutMs}ms)`));
    }, timeoutMs);

    proc.stdout.on("data", (d) => { stdout += d; });
    proc.stderr.on("data", (d) => { stderr += d; });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`${command} exit ${code}: ${stderr.substring(0, 300)}`));
      else resolve(stdout);
    });
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
    proc.stdin.write(stdin);
    proc.stdin.end();
  });
}

/** _normalizeOutput 호출을 위한 최소 어댑터 */
const adapter = Object.create(ModelAdapter.prototype);

// CLI 설치 여부 사전 확인
const claudeOk = isCliInstalled("claude");
const geminiOk = isCliInstalled("gemini");
const codexOk = isCliInstalled("codex");
const allInstalled = claudeOk && geminiOk && codexOk;

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

// ─── Tier 2: 인증 프로브 (최소 API 비용) ─────────────

describe("CLI 인증 프로브", { skip: !allInstalled }, () => {
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

// ─── Tier 3: 실제 코드 생성 ──────────────────────────

describe("Claude 코드 생성", { skip: !claudeOk }, () => {
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

describe("Gemini 코드 생성", { skip: !geminiOk }, () => {
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

describe("Codex 코드 생성", { skip: !codexOk }, () => {
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
