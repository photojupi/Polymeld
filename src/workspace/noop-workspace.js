// src/workspace/noop-workspace.js
// 워크스페이스 미설정 시 사용하는 No-op 클라이언트
// NoOpGitHub과 동일한 패턴

import { t } from "../i18n/index.js";

export class NoOpWorkspace {
  isLocal = false;

  listFiles() { return []; }
  getTree() { return t("workspace.noWorkspace"); }
  readFile() { return ""; }
  findRelevantFiles() { return []; }
  writeFile() {}
  getCurrentBranch() { return "main"; }
  gitCheckoutNewBranch() {}
  gitAdd() {}
  gitCommit() {}
  gitPush() {}
  invalidateCache() {}
}
