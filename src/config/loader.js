// src/config/loader.js
// 설정 파일 로더

import fs from "fs";
import path from "path";
import YAML from "yaml";
import { execFileSync } from "child_process";
import os from "os";

export function loadConfig(configPath) {
  // 설정 파일 경로 결정
  const resolvedPath =
    configPath || findConfigFile() || getDefaultConfigPath();

  if (!fs.existsSync(resolvedPath)) {
    console.error(`설정 파일을 찾을 수 없습니다: ${resolvedPath}`);
    console.error("agent-team.config.yaml 파일을 생성해주세요.");
    process.exit(1);
  }

  const raw = fs.readFileSync(resolvedPath, "utf-8");
  const config = YAML.parse(raw);

  // CLI 설치 여부 검증
  validateCli(config);

  if (!process.env.GITHUB_TOKEN) {
    console.warn("⚠️  GITHUB_TOKEN이 설정되지 않았습니다. GitHub 연동이 제한됩니다.");
  }

  return config;
}

function findConfigFile() {
  const candidates = [
    "agent-team.config.yaml",
    "agent-team.config.yml",
    ".agent-team.yaml",
    ".agent-team.yml",
  ];

  for (const name of candidates) {
    const p = path.resolve(process.cwd(), name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getDefaultConfigPath() {
  return path.resolve(process.cwd(), "agent-team.config.yaml");
}

/**
 * CLI 명령어 존재 여부 확인
 */
function isCliInstalled(command) {
  try {
    const cmd = os.platform() === "win32" ? "where" : "which";
    execFileSync(cmd, [command], { stdio: "pipe", shell: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * CLI 설치 여부를 검증하고 미설치 시 경고/에러 출력
 */
function validateCli(config) {
  const installCommands = {
    claude: "npm install -g @anthropic-ai/claude-code",
    gemini: "npm install -g @google/gemini-cli",
    codex: "npm install -g @openai/codex",
  };

  // 1. 전체 CLI 설치 상태 표시
  const allClis = new Set();
  for (const modelConfig of Object.values(config.models)) {
    allClis.add(modelConfig.cli);
  }

  const missingClis = new Set();
  for (const cli of allClis) {
    if (isCliInstalled(cli)) {
      console.log(`  ✅ ${cli} CLI 설치 확인됨`);
    } else {
      missingClis.add(cli);
      const cmd = installCommands[cli] || `${cli} 설치 필요`;
      console.warn(`  ⚠️  ${cli} CLI가 설치되지 않았습니다.`);
      console.warn(`     → ${cmd}`);
    }
  }

  // 2. 페르소나에 배정된 CLI가 미설치면 에러로 중단
  if (missingClis.size === 0) return;

  const blocked = [];
  for (const [id, persona] of Object.entries(config.personas)) {
    const modelConfig = config.models[persona.model];
    if (modelConfig && missingClis.has(modelConfig.cli)) {
      blocked.push(
        `   - ${persona.name} (${persona.role}) → ${modelConfig.cli} (미설치)`
      );
    }

    // image_model 검증 (선택적 - 경고만)
    if (persona.image_model) {
      const imageModelConfig = config.models[persona.image_model];
      if (!imageModelConfig) {
        console.warn(`  ⚠️  ${persona.name}의 image_model "${persona.image_model}"이 models에 정의되지 않았습니다.`);
      } else if (missingClis.has(imageModelConfig.cli)) {
        console.warn(`  ⚠️  ${persona.name}의 image_model "${persona.image_model}" → ${imageModelConfig.cli} (미설치, 이미지 생성 불가)`);
      }
    }
  }

  if (blocked.length > 0) {
    console.error("\n❌ 사용 중인 페르소나에 필요한 CLI가 설치되지 않았습니다:");
    blocked.forEach((line) => console.error(line));
    console.error("\n위 CLI를 먼저 설치한 후 다시 실행해주세요.\n");
    process.exit(1);
  }
}
