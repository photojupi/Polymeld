// src/repl/status-bar.js
// REPL 프롬프트 위에 현재 상태를 표시하는 상태 바

import chalk from "chalk";
import { t } from "../i18n/index.js";

const MODE_COLORS = {
  "full-auto": chalk.green,
  "semi-auto": chalk.yellow,
  manual: chalk.red,
};

export class StatusBar {
  constructor(shell) {
    this.shell = shell;
  }

  render() {
    const { session } = this.shell;
    const parts = [];

    // 인터랙션 모드
    const mode = session.config.pipeline?.interaction_mode || "full-auto";
    const colorFn = MODE_COLORS[mode] || chalk.gray;
    parts.push(colorFn(mode));

    // Phase 진행 상태
    const completed = session.state.completedPhases.length;
    // Phase 0(코드베이스 분석)은 수정 모드 + 로컬 워크스페이스에서만 실행됨
    const hasCodebasePhase = session.state.completedPhases.includes("codebaseAnalysis");
    const total = hasCodebasePhase ? 8 : 7;
    if (completed === 0) {
      parts.push(chalk.gray(t("repl.statusBar.waiting")));
    } else {
      parts.push(chalk.cyan(t("repl.statusBar.phase", { completed, total })));
    }

    // 팀 인원
    const teamCount = Object.keys(session.config.personas || {}).length;
    if (teamCount > 0) {
      parts.push(chalk.gray(t("repl.statusBar.team", { count: teamCount })));
    }

    // 실행 횟수 (1회 이상일 때만)
    if (session.runs.length > 0) {
      parts.push(chalk.gray(t("repl.statusBar.runs", { count: session.runs.length })));
    }

    return chalk.dim("  ") + parts.join(chalk.dim(" │ "));
  }

  print() {
    if (!process.stdout.isTTY) return;
    console.log(this.render());
  }
}
