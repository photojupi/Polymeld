import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { CliError, ChatResult } from "../src/models/types.js";
import { initI18n } from "../src/i18n/index.js";

before(async () => {
  await initI18n("ko");
});

// ─── ChatResult ──────────────────────────────────────

describe("ChatResult", () => {
  it("String 상속 — 문자열처럼 동작", () => {
    const result = new ChatResult("Hello World", { backend: "cli", model: "claude-3" });
    assert.equal(result.toString(), "Hello World");
    assert.equal(`${result}`, "Hello World");
    assert.equal(result.length, 11);
  });

  it("meta 속성 접근", () => {
    const meta = { backend: "api", model: "gemini-2", usage: { inputTokens: 100, outputTokens: 50 } };
    const result = new ChatResult("response text", meta);
    assert.equal(result.meta.backend, "api");
    assert.equal(result.meta.model, "gemini-2");
    assert.equal(result.meta.usage.inputTokens, 100);
    assert.equal(result.meta.usage.outputTokens, 50);
  });

  it("meta가 null이어도 동작", () => {
    const result = new ChatResult("text", null);
    assert.equal(result.meta, null);
    assert.equal(result.toString(), "text");
  });

  it("빈 문자열도 유효", () => {
    const result = new ChatResult("", { backend: "cli" });
    assert.equal(result.length, 0);
    assert.equal(result.toString(), "");
  });

  it("String 메서드 사용 가능", () => {
    const result = new ChatResult("Hello World", {});
    assert.ok(result.includes("World"));
    assert.equal(result.toUpperCase(), "HELLO WORLD");
    assert.equal(result.slice(0, 5), "Hello");
  });

  it("valueOf()로 문자열 값 추출", () => {
    const result = new ChatResult("test", {});
    assert.equal(result.valueOf(), "test");
  });
});

// ─── CliError._buildMessage ──────────────────────────

describe("CliError._buildMessage", () => {
  it("CLI 이름과 종료 코드 포함", () => {
    const msg = CliError._buildMessage("gemini", 42, "bad input", "");
    assert.ok(msg.includes("gemini"));
    assert.ok(msg.includes("42"));
  });

  it("stderr 우선, 없으면 stdout 사용", () => {
    const withStderr = CliError._buildMessage("claude", 1, "error occurred", "output");
    assert.ok(withStderr.includes("error occurred"));

    const withStdout = CliError._buildMessage("claude", 1, "", "fallback output");
    assert.ok(withStdout.includes("fallback output"));
  });

  it("stderr/stdout 모두 없으면 기본 메시지", () => {
    const msg = CliError._buildMessage("codex", 1, "", "");
    // t("adapter.noOutput") 번역 결과가 포함되어야 함
    assert.ok(msg.length > 0);
  });

  it("1500자 초과 출력은 잘림", () => {
    const longStderr = "a".repeat(3000);
    const msg = CliError._buildMessage("claude", 1, longStderr, "");
    // 전체 메시지에 3000자 전체가 포함되지 않아야 함
    assert.ok(!msg.includes("a".repeat(2000)));
  });
});

// ─── CliError 통합 동작 ──────────────────────────────

describe("CliError 통합", () => {
  it("생성자에서 _buildMessage → super(message) 호출", () => {
    const err = new CliError("claude", 1, "test error", "");
    assert.ok(err.message.length > 0);
    assert.ok(err.message.includes("claude"));
  });

  it("Error 프로토타입 체인 유지", () => {
    const err = new CliError("gemini", 42, "", "");
    assert.ok(err instanceof Error);
    assert.ok(err instanceof CliError);
    assert.ok(err.stack);
  });
});
