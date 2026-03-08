import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  isPlainObject,
  deepMerge,
  mergeLayers,
  parseYaml,
  isCliInstalled,
} from "../src/config/loader.js";

// ─── isPlainObject ──────────────────────────────────

describe("isPlainObject", () => {
  it("{} → true", () => {
    assert.equal(isPlainObject({}), true);
  });

  it("{ a: 1 } → true", () => {
    assert.equal(isPlainObject({ a: 1 }), true);
  });

  it("[] → false", () => {
    assert.equal(isPlainObject([]), false);
  });

  it("null → false", () => {
    assert.equal(isPlainObject(null), false);
  });

  it("new Date() → false", () => {
    assert.equal(isPlainObject(new Date()), false);
  });

  it("문자열 → false", () => {
    assert.equal(isPlainObject("hello"), false);
  });
});

// ─── deepMerge ──────────────────────────────────────

describe("deepMerge", () => {
  it("단순 키 병합", () => {
    const result = deepMerge({ a: 1 }, { b: 2 });
    assert.deepEqual(result, { a: 1, b: 2 });
  });

  it("동일 키 덮어쓰기", () => {
    const result = deepMerge({ a: 1 }, { a: 2 });
    assert.deepEqual(result, { a: 2 });
  });

  it("중첩 객체 재귀 병합", () => {
    const result = deepMerge(
      { models: { claude: { model: "old" } } },
      { models: { claude: { timeout: 300 } } }
    );
    assert.deepEqual(result, {
      models: { claude: { model: "old", timeout: 300 } },
    });
  });

  it("배열은 덮어쓰기 (재귀 병합 아님)", () => {
    const result = deepMerge({ tags: [1, 2] }, { tags: [3] });
    assert.deepEqual(result, { tags: [3] });
  });

  it("원본 객체를 변경하지 않음", () => {
    const target = { a: 1 };
    const source = { b: 2 };
    deepMerge(target, source);
    assert.deepEqual(target, { a: 1 });
  });
});

// ─── mergeLayers ────────────────────────────────────

describe("mergeLayers", () => {
  it("빈 배열 → 빈 객체", () => {
    assert.deepEqual(mergeLayers([]), {});
  });

  it("단일 레이어 → 그대로 반환", () => {
    assert.deepEqual(mergeLayers([{ a: 1 }]), { a: 1 });
  });

  it("3개 레이어 순차 병합 (후순위가 우선)", () => {
    const result = mergeLayers([
      { a: 1, b: { x: 10 } },
      { b: { y: 20 } },
      { a: 3, c: 4 },
    ]);
    assert.deepEqual(result, { a: 3, b: { x: 10, y: 20 }, c: 4 });
  });
});

// ─── parseYaml ──────────────────────────────────────

describe("parseYaml", () => {
  it("유효한 YAML 파싱", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loader-test-"));
    const filePath = path.join(tmpDir, "test.yaml");
    fs.writeFileSync(filePath, "models:\n  claude:\n    model: opus\n");
    const result = parseYaml(filePath);
    assert.deepEqual(result, { models: { claude: { model: "opus" } } });
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("빈 파일 → 빈 객체", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loader-test-"));
    const filePath = path.join(tmpDir, "empty.yaml");
    fs.writeFileSync(filePath, "");
    const result = parseYaml(filePath);
    assert.deepEqual(result, {});
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("스칼라 값 → 빈 객체 (비객체 방어)", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loader-test-"));
    const filePath = path.join(tmpDir, "scalar.yaml");
    fs.writeFileSync(filePath, "hello");
    const result = parseYaml(filePath);
    assert.deepEqual(result, {});
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ─── isCliInstalled ─────────────────────────────────

describe("isCliInstalled", () => {
  it("설치된 명령어(node) → true", () => {
    assert.equal(isCliInstalled("node"), true);
  });

  it("미설치 명령어 → false", () => {
    assert.equal(isCliInstalled("nonexistent_cli_xyz_12345"), false);
  });
});
