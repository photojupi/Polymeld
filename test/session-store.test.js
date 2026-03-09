import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { SessionStore } from "../src/session/session-store.js";

let tmpDir;
let store;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-test-"));
  store = new SessionStore(tmpDir);
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── _sanitizeId ─────────────────────────────────────

describe("SessionStore._sanitizeId", () => {
  it("영숫자 + 하이픈 + 언더스코어 허용", () => {
    assert.equal(store._sanitizeId("my-session_01"), "my-session_01");
  });

  it("특수문자 제거", () => {
    assert.equal(store._sanitizeId("../../etc/passwd"), "etcpasswd");
  });

  it("공백 제거", () => {
    assert.equal(store._sanitizeId("my session"), "mysession");
  });

  it("빈 문자열 → Error", () => {
    assert.throws(() => store._sanitizeId(""), /Invalid session ID/);
  });

  it("특수문자만 → Error (결과가 빈 문자열)", () => {
    assert.throws(() => store._sanitizeId("!@#$%"), /Invalid session ID/);
  });
});

// ─── save / load ─────────────────────────────────────

describe("SessionStore.save & load", () => {
  it("데이터 저장 후 복원", () => {
    const data = { tasks: [{ id: 1, title: "test" }], version: "1.0" };
    const filePath = store.save("test-save", data);
    assert.ok(fs.existsSync(filePath));

    const loaded = store.load("test-save");
    assert.deepEqual(loaded, data);
  });

  it("존재하지 않는 ID → null", () => {
    const result = store.load("nonexistent-id");
    assert.equal(result, null);
  });

  it("손상된 JSON 파일 → null", () => {
    // 먼저 정상 파일을 만든 뒤 덮어써서 순서 의존성 제거
    const filePath = store.save("corrupted", { ok: true });
    fs.writeFileSync(filePath, "{invalid json}", "utf-8");
    const result = store.load("corrupted");
    assert.equal(result, null);
  });

  it("저장 시 디렉토리 자동 생성", () => {
    const newTmpDir = path.join(os.tmpdir(), `session-test-newdir-${Date.now()}`);
    const newStore = new SessionStore(newTmpDir);
    const data = { key: "value" };
    newStore.save("auto-dir", data);
    assert.ok(fs.existsSync(path.join(newTmpDir, ".polymeld/sessions/auto-dir.json")));
    fs.rmSync(newTmpDir, { recursive: true, force: true });
  });
});

// ─── list ────────────────────────────────────────────

describe("SessionStore.list", () => {
  it("저장된 세션 목록 반환", () => {
    store.save("list-a", { a: 1 });
    store.save("list-b", { b: 2 });
    const list = store.list();
    const ids = list.map(s => s.id);
    assert.ok(ids.includes("list-a"));
    assert.ok(ids.includes("list-b"));
  });

  it("updatedAt 역순 정렬", () => {
    const list = store.list();
    for (let i = 1; i < list.length; i++) {
      assert.ok(list[i - 1].updatedAt >= list[i].updatedAt);
    }
  });

  it("각 항목에 id, updatedAt, file 필드 포함", () => {
    const list = store.list();
    for (const item of list) {
      assert.ok("id" in item);
      assert.ok("updatedAt" in item);
      assert.ok("file" in item);
    }
  });
});

// ─── delete ──────────────────────────────────────────

describe("SessionStore.delete", () => {
  it("세션 파일 삭제", () => {
    store.save("to-delete", { temp: true });
    assert.ok(store.load("to-delete") !== null);
    store.delete("to-delete");
    assert.equal(store.load("to-delete"), null);
  });

  it("존재하지 않는 ID 삭제 → 에러 없음", () => {
    assert.doesNotThrow(() => store.delete("never-existed"));
  });
});
