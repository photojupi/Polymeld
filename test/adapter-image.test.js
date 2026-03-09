import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ModelAdapter } from "../src/models/adapter.js";
import { initI18n } from "../src/i18n/index.js";

before(async () => {
  await initI18n("ko");
});

function createMockAdapter(configOverride = {}) {
  const adapter = Object.create(ModelAdapter.prototype);
  adapter.config = { models: {}, ...configOverride };
  adapter._apiClients = {};
  adapter._availableCache = null;
  return adapter;
}

// ─── _needsTransparency ──────────────────────────────

describe("ModelAdapter._needsTransparency", () => {
  const adapter = createMockAdapter();

  it("'transparent' 포함 → true", () => {
    assert.equal(adapter._needsTransparency("Create a transparent logo"), true);
  });

  it("'투명' 포함 → true", () => {
    assert.equal(adapter._needsTransparency("투명 배경 아이콘"), true);
  });

  it("'alpha channel' 포함 → true", () => {
    assert.equal(adapter._needsTransparency("Use alpha channel for PNG"), true);
  });

  it("'no background' 포함 → true", () => {
    assert.equal(adapter._needsTransparency("icon with no background"), true);
  });

  it("'배경 없' 포함 → true", () => {
    assert.equal(adapter._needsTransparency("배경 없는 로고"), true);
  });

  it("'배경없' 포함 → true", () => {
    assert.equal(adapter._needsTransparency("배경없이 만들어줘"), true);
  });

  it("'cutout' 포함 → true", () => {
    assert.equal(adapter._needsTransparency("cutout style image"), true);
  });

  it("'isolated' 포함 → true", () => {
    assert.equal(adapter._needsTransparency("isolated object render"), true);
  });

  it("일반 요청 → false", () => {
    assert.equal(adapter._needsTransparency("Draw a cat sitting on a chair"), false);
  });

  it("null → false", () => {
    assert.equal(adapter._needsTransparency(null), false);
  });

  it("빈 문자열 → false", () => {
    assert.equal(adapter._needsTransparency(""), false);
  });

  it("대소문자 무관 매칭", () => {
    assert.equal(adapter._needsTransparency("TRANSPARENT background"), true);
  });
});

// ─── _resolveImageEngine ─────────────────────────────

describe("ModelAdapter._resolveImageEngine", () => {
  const savedEnv = {};

  before(() => {
    savedEnv.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
    savedEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (savedEnv.GOOGLE_API_KEY !== undefined) process.env.GOOGLE_API_KEY = savedEnv.GOOGLE_API_KEY;
    else delete process.env.GOOGLE_API_KEY;
    if (savedEnv.OPENAI_API_KEY !== undefined) process.env.OPENAI_API_KEY = savedEnv.OPENAI_API_KEY;
    else delete process.env.OPENAI_API_KEY;
  });

  it("Gemini key만 있을 때 → 'gemini'", () => {
    process.env.GOOGLE_API_KEY = "test-gemini-key";
    delete process.env.OPENAI_API_KEY;
    const adapter = createMockAdapter();
    assert.equal(adapter._resolveImageEngine("아이콘 그려줘"), "gemini");
  });

  it("OpenAI key만 있을 때 → 'gpt'", () => {
    delete process.env.GOOGLE_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const adapter = createMockAdapter();
    assert.equal(adapter._resolveImageEngine("아이콘 그려줘"), "gpt");
  });

  it("양쪽 키 모두 없을 때 → Error", () => {
    delete process.env.GOOGLE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const adapter = createMockAdapter();
    assert.throws(() => adapter._resolveImageEngine("아이콘 그려줘"));
  });

  it("양쪽 키 있고 투명 키워드 없을 때 → 'gemini'", () => {
    process.env.GOOGLE_API_KEY = "test-gemini-key";
    process.env.OPENAI_API_KEY = "test-openai-key";
    const adapter = createMockAdapter();
    assert.equal(adapter._resolveImageEngine("고양이 그려줘"), "gemini");
  });

  it("양쪽 키 있고 'transparent' 포함 → 'gpt'", () => {
    process.env.GOOGLE_API_KEY = "test-gemini-key";
    process.env.OPENAI_API_KEY = "test-openai-key";
    const adapter = createMockAdapter();
    assert.equal(adapter._resolveImageEngine("transparent logo icon"), "gpt");
  });

  it("양쪽 키 있고 '투명' 포함 → 'gpt'", () => {
    process.env.GOOGLE_API_KEY = "test-gemini-key";
    process.env.OPENAI_API_KEY = "test-openai-key";
    const adapter = createMockAdapter();
    assert.equal(adapter._resolveImageEngine("투명 배경으로 만들어줘"), "gpt");
  });
});

// ─── getAvailableModels ──────────────────────────────

describe("ModelAdapter.getAvailableModels", () => {
  it("CLI 미설치 + API key 없음 → 빈 배열", () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const adapter = createMockAdapter({
      models: { claude: { cli: "unknown_cli_that_does_not_exist", model: "test" } },
    });
    const result = adapter.getAvailableModels();
    assert.equal(result.length, 0);
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    else delete process.env.ANTHROPIC_API_KEY;
  });

  it("API key 있으면 해당 모델 포함", () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";
    const adapter = createMockAdapter({
      models: { my_claude: { cli: "claude", model: "claude-3" } },
    });
    const result = adapter.getAvailableModels();
    assert.ok(result.includes("my_claude"));
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    else delete process.env.ANTHROPIC_API_KEY;
  });

  it("캐시 동작 — 두 번째 호출은 같은 배열 반환", () => {
    const adapter = createMockAdapter({ models: {} });
    const first = adapter.getAvailableModels();
    const second = adapter.getAvailableModels();
    assert.equal(first, second); // 참조 동일
  });
});

// ─── getCliStatus ────────────────────────────────────

describe("ModelAdapter.getCliStatus", () => {
  it("모델별 상태 객체 반환", () => {
    const adapter = createMockAdapter({
      models: {
        my_claude: { cli: "claude", model: "claude-3" },
        my_gemini: { cli: "gemini", model: "gemini-2" },
      },
    });
    const status = adapter.getCliStatus();
    assert.ok("my_claude" in status);
    assert.ok("my_gemini" in status);
    assert.equal(status.my_claude.cli, "claude");
    assert.equal(status.my_gemini.cli, "gemini");
    assert.equal(typeof status.my_claude.installed, "boolean");
    assert.equal(typeof status.my_claude.hasApiKey, "boolean");
    assert.ok(status.my_claude.installCommand);
  });

  it("빈 models → 빈 객체", () => {
    const adapter = createMockAdapter({ models: {} });
    const status = adapter.getCliStatus();
    assert.deepEqual(status, {});
  });
});
