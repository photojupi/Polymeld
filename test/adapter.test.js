import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { CliError, ModelAdapter } from "../src/models/adapter.js";
import { initI18n } from "../src/i18n/index.js";

before(async () => {
  await initI18n("ko");
});

// ModelAdapter 순수 메서드 테스트를 위한 최소 mock
function createMockAdapter() {
  const adapter = Object.create(ModelAdapter.prototype);
  adapter.config = { models: {} };
  adapter._apiClients = {};
  adapter._availableCache = null;
  return adapter;
}

// ─── CliError._categorize ────────────────────────────

describe("CliError._categorize", () => {
  it("stderr rate_limit이 exit code보다 우선", () => {
    assert.equal(CliError._categorize("gemini", 41, "Rate limit reached"), "rate_limit");
  });

  it("gemini 41 → auth", () => {
    assert.equal(CliError._categorize("gemini", 41, ""), "auth");
  });

  it("gemini 42 → input", () => {
    assert.equal(CliError._categorize("gemini", 42, ""), "input");
  });

  it("gemini 44 → sandbox", () => {
    assert.equal(CliError._categorize("gemini", 44, ""), "sandbox");
  });

  it("gemini 52 → config", () => {
    assert.equal(CliError._categorize("gemini", 52, ""), "config");
  });

  it("gemini 53 → turn_limit", () => {
    assert.equal(CliError._categorize("gemini", 53, ""), "turn_limit");
  });

  it("claude 2 → blocking", () => {
    assert.equal(CliError._categorize("claude", 2, ""), "blocking");
  });

  it("일반 exit code 1 → runtime", () => {
    assert.equal(CliError._categorize("claude", 1, ""), "runtime");
    assert.equal(CliError._categorize("codex", 1, ""), "runtime");
  });

  it("알 수 없는 exit code → unknown", () => {
    assert.equal(CliError._categorize("claude", 99, ""), "unknown");
  });
});

// ─── CliError._isRateLimit ───────────────────────────

describe("CliError._isRateLimit", () => {
  it("usage limit 패턴 감지", () => {
    assert.equal(CliError._isRateLimit("You've hit your usage limit"), true);
  });

  it("rate limit 패턴 감지", () => {
    assert.equal(CliError._isRateLimit("Rate limit reached"), true);
  });

  it("HTTP 429 감지", () => {
    assert.equal(CliError._isRateLimit("Error 429 too many requests"), true);
  });

  it("resource exhausted 감지", () => {
    assert.equal(CliError._isRateLimit("RESOURCE_EXHAUSTED"), true);
  });

  it("overloaded_error 감지", () => {
    assert.equal(CliError._isRateLimit("overloaded_error"), true);
  });

  it("rateLimitExceeded 감지", () => {
    assert.equal(CliError._isRateLimit("rateLimitExceeded"), true);
  });

  it("빈 문자열 → false", () => {
    assert.equal(CliError._isRateLimit(""), false);
  });

  it("null → false", () => {
    assert.equal(CliError._isRateLimit(null), false);
  });

  it("일반 에러 메시지 → false", () => {
    assert.equal(CliError._isRateLimit("Something went wrong"), false);
  });
});

// ─── CliError.isRetryable ────────────────────────────

describe("CliError.isRetryable", () => {
  it("runtime → 재시도 가능", () => {
    const err = new CliError("claude", 1, "error", "");
    assert.equal(err.isRetryable, true);
  });

  it("unknown → 재시도 가능", () => {
    const err = new CliError("claude", 99, "error", "");
    assert.equal(err.isRetryable, true);
  });

  it("rate_limit → 재시도 불가", () => {
    const err = new CliError("claude", 1, "Rate limit reached", "");
    assert.equal(err.isRetryable, false);
  });

  it("auth → 재시도 불가", () => {
    const err = new CliError("gemini", 41, "", "");
    assert.equal(err.isRetryable, false);
  });

  it("blocking → 재시도 불가", () => {
    const err = new CliError("claude", 2, "", "");
    assert.equal(err.isRetryable, false);
  });
});

// ─── CliError 생성자 ────────────────────────────────

describe("CliError 생성자", () => {
  it("속성이 올바르게 설정됨", () => {
    const err = new CliError("gemini", 42, "bad input", "output");
    assert.equal(err.cli, "gemini");
    assert.equal(err.exitCode, 42);
    assert.equal(err.stderr, "bad input");
    assert.equal(err.stdout, "output");
    assert.equal(err.category, "input");
    assert.equal(err.name, "CliError");
    assert.ok(err instanceof Error);
  });
});

// ─── ModelAdapter._normalizeOutput ───────────────────

describe("ModelAdapter._normalizeOutput", () => {
  const adapter = createMockAdapter();

  it("ANSI 이스케이프 코드 제거", () => {
    const raw = "\x1b[32mHello\x1b[0m World";
    assert.equal(adapter._normalizeOutput(raw, "claude"), "Hello World");
  });

  it("codex TUI 진행률 라인 제거", () => {
    const raw = "Thinking about code...\nExecuting command...\nActual output";
    assert.equal(adapter._normalizeOutput(raw, "codex"), "Actual output");
  });

  it("gemini 구분선 제거", () => {
    const raw = "━━━━━━━━━━\nResult text\n──────────";
    assert.equal(adapter._normalizeOutput(raw, "gemini"), "Result text");
  });

  it("전후 공백 제거", () => {
    assert.equal(adapter._normalizeOutput("  hello  ", "claude"), "hello");
  });

  it("codex JSONL 스트리밍 이벤트 라인 제거", () => {
    const raw = '{"type":"thread.started","thread_id":"abc"}\n{"type":"turn.started"}\nActual output\n{"type":"turn.completed","usage":{"input_tokens":100}}';
    assert.equal(adapter._normalizeOutput(raw, "codex"), "Actual output");
  });

  it("codex JSONL 후행 공백 포함 라인도 제거", () => {
    const raw = '{"type":"item.completed","item":{}}  \nOutput text';
    assert.equal(adapter._normalizeOutput(raw, "codex"), "Output text");
  });
});

// ─── ModelAdapter._buildCombinedPrompt ───────────────

describe("ModelAdapter._buildCombinedPrompt", () => {
  const adapter = createMockAdapter();

  it("시스템 프롬프트와 사용자 메시지를 합침", () => {
    const result = adapter._buildCombinedPrompt("system instructions", "user request");
    assert.ok(result.includes("system instructions"));
    assert.ok(result.includes("user request"));
    assert.ok(result.includes("---"));
  });
});

// ─── ModelAdapter._resolveThinkingArgs ───────────────

describe("ModelAdapter._resolveThinkingArgs", () => {
  const adapter = createMockAdapter();

  it("budget null → 빈 배열", () => {
    assert.deepEqual(adapter._resolveThinkingArgs("claude", null), []);
    assert.deepEqual(adapter._resolveThinkingArgs("claude", undefined), []);
  });

  it("claude: budget 0-33 → effort low", () => {
    const args = adapter._resolveThinkingArgs("claude", 20);
    assert.deepEqual(args, ["--effort", "low"]);
  });

  it("claude: budget 34-75 → effort medium", () => {
    const args = adapter._resolveThinkingArgs("claude", 50);
    assert.deepEqual(args, ["--effort", "medium"]);
  });

  it("claude: budget 76-100 → effort high", () => {
    const args = adapter._resolveThinkingArgs("claude", 90);
    assert.deepEqual(args, ["--effort", "high"]);
  });

  it("gemini → 항상 빈 배열", () => {
    assert.deepEqual(adapter._resolveThinkingArgs("gemini", 50), []);
    assert.deepEqual(adapter._resolveThinkingArgs("gemini", 100), []);
  });

  it("codex: budget 0-25 → reasoning low", () => {
    const args = adapter._resolveThinkingArgs("codex", 10);
    assert.deepEqual(args, ["-c", 'model_reasoning_effort="low"']);
  });

  it("codex: budget 86-100 → reasoning xhigh", () => {
    const args = adapter._resolveThinkingArgs("codex", 95);
    assert.deepEqual(args, ["-c", 'model_reasoning_effort="xhigh"']);
  });

  it("알 수 없는 CLI → 빈 배열", () => {
    assert.deepEqual(adapter._resolveThinkingArgs("unknown", 50), []);
  });
});

// ─── ModelAdapter._isApiRateLimit ────────────────────

describe("ModelAdapter._isApiRateLimit", () => {
  const adapter = createMockAdapter();

  it("status 429 → true", () => {
    assert.equal(adapter._isApiRateLimit({ status: 429 }), true);
  });

  it("error.type rate_limit_error → true", () => {
    assert.equal(adapter._isApiRateLimit({ error: { type: "rate_limit_error" } }), true);
  });

  it("error.code rate_limit_exceeded → true", () => {
    assert.equal(adapter._isApiRateLimit({ code: "rate_limit_exceeded" }), true);
  });

  it("message에 resource exhausted → true", () => {
    assert.equal(adapter._isApiRateLimit({ message: "Resource exhausted" }), true);
  });

  it("일반 에러 → false", () => {
    assert.equal(adapter._isApiRateLimit({ status: 500, message: "Internal error" }), false);
  });

  it("null → false", () => {
    assert.equal(adapter._isApiRateLimit(null), false);
  });
});

// ─── ModelAdapter._hasApiKey ────────────────────────

describe("ModelAdapter._hasApiKey", () => {
  const adapter = createMockAdapter();

  it("ANTHROPIC_API_KEY 설정됨 → claude true", () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";
    assert.equal(adapter._hasApiKey("claude"), true);
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    else delete process.env.ANTHROPIC_API_KEY;
  });

  it("ANTHROPIC_API_KEY 미설정 → claude false", () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(adapter._hasApiKey("claude"), false);
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  });

  it("알 수 없는 CLI → false", () => {
    assert.equal(adapter._hasApiKey("unknown"), false);
  });
});
