import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  getCredentialStatus,
  saveCredentials,
  loadCredentials,
} from "../src/config/credentials.js";

// ─── getCredentialStatus ─────────────────────────────

describe("getCredentialStatus", () => {
  const keys = ["GITHUB_TOKEN", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "OPENAI_API_KEY"];
  const saved = {};

  before(() => {
    for (const key of keys) {
      saved[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of keys) {
      if (saved[key] !== undefined) process.env[key] = saved[key];
      else delete process.env[key];
    }
  });

  it("4개 키 모두 반환", () => {
    const status = getCredentialStatus();
    assert.equal(status.length, 4);
    const returnedKeys = status.map(s => s.key);
    for (const key of keys) {
      assert.ok(returnedKeys.includes(key));
    }
  });

  it("설정된 키 → set: true, masked 포함", () => {
    process.env.GITHUB_TOKEN = "ghp_1234567890abcdef";
    const status = getCredentialStatus();
    const ghStatus = status.find(s => s.key === "GITHUB_TOKEN");
    assert.equal(ghStatus.set, true);
    assert.ok(ghStatus.masked);
    assert.ok(ghStatus.masked.startsWith("ghp_"));
    assert.ok(ghStatus.masked.includes("..."));
    assert.ok(ghStatus.masked.endsWith("cdef"));
  });

  it("미설정 키 → set: false, masked: null", () => {
    delete process.env.OPENAI_API_KEY;
    const status = getCredentialStatus();
    const oaiStatus = status.find(s => s.key === "OPENAI_API_KEY");
    assert.equal(oaiStatus.set, false);
    assert.equal(oaiStatus.masked, null);
  });

  it("짧은 키 (8자 이하) → '****'로 마스킹", () => {
    process.env.GOOGLE_API_KEY = "short";
    const status = getCredentialStatus();
    const gStatus = status.find(s => s.key === "GOOGLE_API_KEY");
    assert.equal(gStatus.set, true);
    assert.equal(gStatus.masked, "****");
  });
});

// ─── saveCredentials / loadCredentials ────────────────
// HOME 환경 변수를 임시로 변경하여 실제 함수를 테스트

describe("saveCredentials & loadCredentials", () => {
  let tmpDir;
  let savedHome;
  const credKeys = ["ANTHROPIC_API_KEY", "GOOGLE_API_KEY"];
  const savedEnv = {};

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cred-test-"));
    savedHome = process.env.HOME;
    process.env.HOME = tmpDir;
    for (const key of credKeys) {
      savedEnv[key] = process.env[key];
    }
  });

  after(() => {
    if (savedHome !== undefined) process.env.HOME = savedHome;
    else delete process.env.HOME;
    for (const key of credKeys) {
      if (savedEnv[key] !== undefined) process.env[key] = savedEnv[key];
      else delete process.env[key];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saveCredentials로 파일 저장 후 경로 반환", () => {
    const filePath = saveCredentials({ ANTHROPIC_API_KEY: "sk-ant-test123" });
    assert.ok(fs.existsSync(filePath));
    assert.ok(filePath.endsWith("credentials.yaml"));
  });

  it("saveCredentials 병합 — 기존 값 보존", async () => {
    saveCredentials({ ANTHROPIC_API_KEY: "sk-ant-first" });
    saveCredentials({ GOOGLE_API_KEY: "AIza-second" });

    const { default: YAML } = await import("yaml");
    const credPath = path.join(tmpDir, ".polymeld", "credentials.yaml");
    const parsed = YAML.parse(fs.readFileSync(credPath, "utf-8"));
    assert.equal(parsed.ANTHROPIC_API_KEY, "sk-ant-first");
    assert.equal(parsed.GOOGLE_API_KEY, "AIza-second");
  });

  it("loadCredentials — env에 없는 키만 주입", () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.GOOGLE_API_KEY = "already-set";

    saveCredentials({ ANTHROPIC_API_KEY: "from-file", GOOGLE_API_KEY: "from-file" });
    loadCredentials();

    assert.equal(process.env.ANTHROPIC_API_KEY, "from-file");
    assert.equal(process.env.GOOGLE_API_KEY, "already-set"); // 기존 env 우선
  });

  it("credentials.yaml 없으면 loadCredentials는 조용히 반환", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "cred-empty-"));
    process.env.HOME = emptyDir;
    assert.doesNotThrow(() => loadCredentials());
    process.env.HOME = tmpDir; // 복원
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
