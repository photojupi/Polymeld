// src/config/credentials.js
// 글로벌 자격 증명 관리 (~/.polymeld/credentials.yaml)

import fs from "fs";
import path from "path";
import YAML from "yaml";
import { getGlobalConfigDir } from "./paths.js";

const CREDENTIAL_KEYS = [
  "GITHUB_TOKEN",
  "GITHUB_REPO",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
];

/**
 * ~/.polymeld/credentials.yaml에서 자격 증명을 로드하여 process.env에 주입.
 * 이미 환경 변수에 설정된 값은 덮어쓰지 않음 (env var 우선).
 */
export function loadCredentials() {
  const credPath = path.join(getGlobalConfigDir(), "credentials.yaml");
  if (!fs.existsSync(credPath)) return;

  let creds;
  try {
    const raw = fs.readFileSync(credPath, "utf-8");
    creds = YAML.parse(raw) || {};
  } catch {
    return;
  }

  for (const key of CREDENTIAL_KEYS) {
    if (creds[key] && !process.env[key]) {
      process.env[key] = creds[key];
    }
  }
}

/**
 * credentials.yaml에 자격 증명 저장.
 * 기존 값을 유지하면서 새 값을 병합한다.
 * @returns {string} 저장된 파일 경로
 */
export function saveCredentials(entries) {
  const globalDir = getGlobalConfigDir();
  fs.mkdirSync(globalDir, { recursive: true });

  const credPath = path.join(globalDir, "credentials.yaml");

  let existing = {};
  if (fs.existsSync(credPath)) {
    try {
      existing = YAML.parse(fs.readFileSync(credPath, "utf-8")) || {};
    } catch {
      // 파싱 실패 시 빈 객체로 시작
    }
  }

  const merged = { ...existing, ...entries };
  fs.writeFileSync(credPath, YAML.stringify(merged), { encoding: "utf-8", mode: 0o600 });

  // 기존 파일 덮어쓰기 시 권한 재설정 (macOS/Linux만)
  try {
    fs.chmodSync(credPath, 0o600);
  } catch {
    // Windows에서는 chmod 미지원
  }

  return credPath;
}

/**
 * 현재 설정된 자격 증명 상태 반환
 */
export function getCredentialStatus() {
  return CREDENTIAL_KEYS.map((key) => {
    const val = process.env[key];
    return {
      key,
      set: !!val,
      masked: val
        ? (val.length > 8 ? val.substring(0, 4) + "..." + val.slice(-4) : "****")
        : null,
    };
  });
}
