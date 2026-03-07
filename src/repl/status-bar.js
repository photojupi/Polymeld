// src/repl/status-bar.js
// REPL 프롬프트 위에 현재 상태를 표시하는 상태 바

import chalk from "chalk";

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
    const mode = session.config.pipeline?.interaction_mode || "semi-auto";
    const colorFn = MODE_COLORS[mode] || chalk.gray;
    parts.push(colorFn(mode));

    // Phase 진행 상태
    const completed = session.state.completedPhases.length;
    if (completed === 0) {
      parts.push(chalk.gray("대기"));
    } else {
      parts.push(chalk.cyan(`${completed}/9 Phase`));
    }

    // 팀 인원
    const teamCount = Object.keys(session.config.personas || {}).length;
    if (teamCount > 0) {
      parts.push(chalk.gray(`팀 ${teamCount}명`));
    }

    // 실행 횟수 (1회 이상일 때만)
    if (session.runs.length > 0) {
      parts.push(chalk.gray(`실행 ${session.runs.length}회`));
    }

    return chalk.dim("  ") + parts.join(chalk.dim(" │ "));
  }

  print() {
    if (!process.stdout.isTTY) return;
    console.log(this.render());
  }
}
