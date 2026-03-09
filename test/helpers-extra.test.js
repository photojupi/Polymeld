import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  isImageTask,
  parseMultiFileResponse,
} from "../src/pipeline/orchestrator.js";
import { initI18n } from "../src/i18n/index.js";

before(async () => {
  await initI18n("ko");
});

// ─── isImageTask (category 기반 로직) ────────────────

describe("isImageTask — category 분기", () => {
  it("category 'art' → true", () => {
    assert.equal(isImageTask({ title: "캐릭터", category: "art" }), true);
  });

  it("category 'asset' → true", () => {
    assert.equal(isImageTask({ title: "스프라이트", category: "asset" }), true);
  });

  it("category 'code' → 키워드 없으면 false", () => {
    assert.equal(isImageTask({ title: "API 구현", category: "code" }), false);
  });
});

describe("isImageTask — UI 단어 경계 매칭", () => {
  it("'UI design' → true (단어 경계)", () => {
    assert.equal(isImageTask({ title: "UI design" }), true);
  });

  it("'build' → false (ui 포함하지 않음)", () => {
    assert.equal(isImageTask({ title: "build system" }), false);
  });

  it("'fluid' → false (ui 포함하지만 단어 경계 아님)", () => {
    assert.equal(isImageTask({ title: "fluid animation" }), false);
  });

  it("'GUI layout' → false (ui가 독립 단어가 아님)", () => {
    assert.equal(isImageTask({ title: "GUI layout" }), false);
  });
});

describe("isImageTask — 추가 키워드", () => {
  it("'sprite' → true", () => {
    assert.equal(isImageTask({ title: "스프라이트 시트 제작" }), true);
  });

  it("'texture' → true", () => {
    assert.equal(isImageTask({ description: "texture mapping" }), true);
  });

  it("'render' → true", () => {
    assert.equal(isImageTask({ title: "3D 렌더링" }), true);
  });

  it("'concept' → true", () => {
    assert.equal(isImageTask({ title: "컨셉 아트" }), true);
  });
});

// ─── parseMultiFileResponse ──────────────────────────

describe("parseMultiFileResponse", () => {
  it("null → 빈 배열", () => {
    assert.deepEqual(parseMultiFileResponse(null), []);
  });

  it("빈 문자열 → 빈 배열", () => {
    assert.deepEqual(parseMultiFileResponse(""), []);
  });

  it("코드블록 1개만 → 빈 배열 (2개 미만)", () => {
    const text = "```js src/app.js\nconsole.log('hi');\n```";
    assert.deepEqual(parseMultiFileResponse(text), []);
  });

  it("코드블록 2개 이상 → 파일별 분리", () => {
    const text = [
      "다음 파일을 생성합니다:",
      "```js src/utils/helper.js",
      "export function add(a, b) { return a + b; }",
      "```",
      "```js src/index.js",
      "import { add } from './utils/helper.js';",
      "```",
    ].join("\n");
    const result = parseMultiFileResponse(text);
    assert.equal(result.length, 2);
    assert.equal(result[0].filePath, "src/utils/helper.js");
    assert.ok(result[0].code.includes("export function add"));
    assert.equal(result[1].filePath, "src/index.js");
  });

  it("절대 경로 포함 블록 → 제외", () => {
    const text = [
      "```js /etc/passwd",
      "malicious",
      "```",
      "```js src/a.js",
      "safe1",
      "```",
      "```js src/b.js",
      "safe2",
      "```",
    ].join("\n");
    const result = parseMultiFileResponse(text);
    assert.equal(result.length, 2);
    assert.ok(result.every(r => !r.filePath.startsWith("/")));
  });

  it("'..' 포함 경로 → 제외", () => {
    const text = [
      "```js ../escape/hack.js",
      "bad",
      "```",
      "```js src/a.js",
      "ok1",
      "```",
      "```js src/b.js",
      "ok2",
      "```",
    ].join("\n");
    const result = parseMultiFileResponse(text);
    assert.equal(result.length, 2);
    assert.ok(result.every(r => !r.filePath.includes("..")));
  });

  it("허용되지 않는 확장자 → 제외", () => {
    const text = [
      "```txt readme.exe",
      "nope",
      "```",
      "```js src/a.js",
      "ok1",
      "```",
      "```js src/b.js",
      "ok2",
      "```",
    ].join("\n");
    const result = parseMultiFileResponse(text);
    assert.equal(result.length, 2);
  });

  it("다양한 확장자 인식", () => {
    const text = [
      "```python scripts/build.py",
      "import os",
      "```",
      "```yaml config.yaml",
      "key: val",
      "```",
    ].join("\n");
    const result = parseMultiFileResponse(text);
    assert.equal(result.length, 2);
    assert.equal(result[0].filePath, "scripts/build.py");
    assert.equal(result[1].filePath, "config.yaml");
  });
});
