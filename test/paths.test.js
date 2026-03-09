import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import {
  getGlobalConfigDir,
  getProjectConfigDir,
  expandHome,
} from "../src/config/paths.js";

// ─── getGlobalConfigDir ──────────────────────────────

describe("getGlobalConfigDir", () => {
  it("홈 디렉토리 아래 .polymeld 반환", () => {
    const result = getGlobalConfigDir();
    assert.equal(result, path.join(os.homedir(), ".polymeld"));
  });
});

// ─── getProjectConfigDir ─────────────────────────────

describe("getProjectConfigDir", () => {
  it("root 인자 기준 .polymeld 반환", () => {
    const result = getProjectConfigDir("/tmp/myproject");
    assert.equal(result, path.join("/tmp/myproject", ".polymeld"));
  });

  it("root 미지정 시 cwd 기준", () => {
    const result = getProjectConfigDir();
    assert.equal(result, path.join(process.cwd(), ".polymeld"));
  });
});

// ─── expandHome ──────────────────────────────────────

describe("expandHome", () => {
  it("'~' → 홈 디렉토리", () => {
    assert.equal(expandHome("~"), os.homedir());
  });

  it("'~/foo' → 홈/foo", () => {
    assert.equal(expandHome("~/foo"), path.join(os.homedir(), "foo"));
  });

  it("'~/nested/path' → 홈/nested/path", () => {
    assert.equal(expandHome("~/nested/path"), path.join(os.homedir(), "nested/path"));
  });

  it("'~\\\\foo' (Windows 스타일) → 홈/foo", () => {
    assert.equal(expandHome("~\\foo"), path.join(os.homedir(), "foo"));
  });

  it("절대 경로 → 그대로 반환", () => {
    assert.equal(expandHome("/absolute/path"), "/absolute/path");
  });

  it("상대 경로 → 그대로 반환", () => {
    assert.equal(expandHome("relative/path"), "relative/path");
  });

  it("빈 문자열 → 그대로 반환", () => {
    assert.equal(expandHome(""), "");
  });

  it("'~abc' (유저명) → 그대로 반환 (~/가 아니므로)", () => {
    assert.equal(expandHome("~abc"), "~abc");
  });
});
