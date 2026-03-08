// src/config/loader.js
// 설정 파일 로더 (순수 파일 파싱/병합)

import fs from "fs";
import path from "path";
import YAML from "yaml";
import { execFileSync } from "child_process";
import os from "os";
import chalk from "chalk";
import { t } from "../i18n/index.js";
import { getGlobalConfigDir, getProjectConfigDir } from "./paths.js";

/**
 * 글로벌 설정 존재 여부 확인 (온보딩 분기용)
 */
export function hasGlobalConfig() {
  const globalConfig = path.join(getGlobalConfigDir(), "config.yaml");
  return fs.existsSync(globalConfig);
}

/**
 * 설정 로드 (계층적 병합)
 * -c 플래그: 해당 파일만 사용 (하위 호환)
 * 플래그 없음: 글로벌 → 프로젝트 공유 → 프로젝트 로컬 → 레거시 CWD 순서로 병합
 */
export function loadConfig(configPath) {
  // 명시적 경로 지정 시: 기존 동작 유지
  if (configPath) {
    const resolved = path.resolve(configPath);
    if (!fs.existsSync(resolved)) {
      console.error(t("config.configNotFound", { path: resolved }));
      process.exit(1);
    }
    return parseYaml(resolved);
  }

  // 계층적 설정 로드
  const layers = [];

  // 1) 글로벌: ~/.polymeld/config.yaml
  const globalConfig = path.join(getGlobalConfigDir(), "config.yaml");
  if (fs.existsSync(globalConfig)) {
    layers.push(parseYaml(globalConfig));
  }

  // 2) 프로젝트 공유: .polymeld/config.yaml
  const projectConfig = path.join(getProjectConfigDir(), "config.yaml");
  if (fs.existsSync(projectConfig)) {
    layers.push(parseYaml(projectConfig));
  }

  // 3) 프로젝트 로컬: .polymeld/config.local.yaml
  const localConfig = path.join(getProjectConfigDir(), "config.local.yaml");
  if (fs.existsSync(localConfig)) {
    layers.push(parseYaml(localConfig));
  }

  // 4) 레거시 CWD: polymeld.config.yaml 등 (하위 호환)
  const legacyPath = findLegacyConfigFile();
  if (legacyPath) {
    layers.push(parseYaml(legacyPath));
  }

  if (layers.length === 0) {
    // First-run 감지
    console.log(chalk.yellow(`\n${t("config.firstRunMessage")}`));
    console.log(chalk.gray(`  ${t("config.firstRunHint")}\n`));
    process.exit(1);
  }

  return mergeLayers(layers);
}

export function parseYaml(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = YAML.parse(raw);
  return parsed && typeof parsed === "object" ? parsed : {};
}

function findLegacyConfigFile() {
  const candidates = [
    "polymeld.config.yaml",
    "polymeld.config.yml",
    ".polymeld.yaml",
    ".polymeld.yml",
  ];

  for (const name of candidates) {
    const p = path.resolve(process.cwd(), name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype;
}

export function deepMerge(target, source) {
  const output = { ...target };
  for (const key of Object.keys(source)) {
    if (isPlainObject(source[key]) && isPlainObject(target[key])) {
      output[key] = deepMerge(target[key], source[key]);
    } else {
      output[key] = source[key];
    }
  }
  return output;
}

export function mergeLayers(layers) {
  let result = {};
  for (const layer of layers) {
    result = deepMerge(result, layer);
  }
  return result;
}

/**
 * CLI 명령어 존재 여부 확인
 */
export function isCliInstalled(command) {
  try {
    const cmd = os.platform() === "win32" ? "where" : "which";
    execFileSync(cmd, [command], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// 하위 호환: 기존 import { validateConnections, probeCliAuth } from './loader.js' 유지
export { validateConnections, probeCliAuth } from "./validator.js";
