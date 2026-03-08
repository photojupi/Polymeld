// src/models/types.js
// AI 모델 어댑터에서 사용하는 타입 클래스 (CliError, ChatResult)

import { t } from "../i18n/index.js";

/**
 * CLI 실행 오류를 구조화하여 표현하는 커스텀 에러 클래스.
 * CLI별 종료 코드를 카테고리로 분류하고, 재시도 가능 여부를 판단한다.
 */
export class CliError extends Error {
  constructor(cli, exitCode, stderr, stdout) {
    const message = CliError._buildMessage(cli, exitCode, stderr, stdout);
    super(message);
    this.name = "CliError";
    this.cli = cli;
    this.exitCode = exitCode;
    this.stderr = stderr;
    this.stdout = stdout;
    this.category = CliError._categorize(cli, exitCode, stderr);
  }

  /**
   * CLI 이름과 종료 코드, stderr 내용을 기반으로 에러 카테고리를 분류한다.
   */
  static _categorize(cli, code, stderr = "") {
    // Rate limit 감지 (모든 CLI 공통, exit code보다 우선)
    if (CliError._isRateLimit(stderr)) return "rate_limit";
    // Gemini 고유 종료 코드
    if (cli === "gemini") {
      if (code === 41) return "auth";
      if (code === 42) return "input";
      if (code === 44) return "sandbox";
      if (code === 52) return "config";
      if (code === 53) return "turn_limit";
    }
    // Claude 고유 종료 코드
    if (cli === "claude" && code === 2) return "blocking";
    // 일반 분류
    if (code === 1) return "runtime";
    return "unknown";
  }

  /**
   * stderr 내용에서 rate limit / 사용량 한도 초과를 감지한다.
   * - Codex: "You've hit your usage limit", "Rate limit reached"
   * - Claude: "Rate limit reached", "overloaded_error", "rate_limit_error"
   * - Gemini: "Resource exhausted", "RESOURCE_EXHAUSTED", "rateLimitExceeded"
   */
  static _isRateLimit(stderr) {
    if (!stderr) return false;
    return /usage.?limit|rate.?limit|too many requests|resource.?exhausted|quota.?exceeded|overloaded_error|rateLimitExceeded/i.test(stderr)
      || /\b429\b/.test(stderr);
  }

  /**
   * 사용자에게 표시할 에러 메시지를 생성한다.
   */
  static _buildMessage(cli, code, stderr, stdout) {
    const output = (stderr || stdout || t("adapter.noOutput")).substring(0, 1500);
    return t("adapter.cliError", { cli, code, output });
  }

  /**
   * 재시도 가능한 에러인지 여부를 반환한다.
   * runtime, unknown 카테고리만 재시도 가능으로 판단.
   */
  get isRetryable() {
    return ["runtime", "unknown"].includes(this.category);
  }
}

/**
 * chat() 반환값. String을 상속하여 기존 문자열 사용 코드와 호환되면서
 * .meta로 백엔드/모델/토큰 메타데이터에 접근할 수 있다.
 */
export class ChatResult extends String {
  constructor(text, meta) {
    super(text);
    this.meta = meta; // { backend: "cli"|"api", model: string, usage: { inputTokens, outputTokens } | null }
  }
}
