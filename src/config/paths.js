// src/config/paths.js
// 크로스 플랫폼 경로 유틸리티

import os from "os";
import path from "path";

export function getGlobalConfigDir() {
  return path.join(os.homedir(), ".polymeld");
}

export function getProjectConfigDir(root = process.cwd()) {
  return path.join(root, ".polymeld");
}

export function expandHome(p) {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}
