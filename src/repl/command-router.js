// src/repl/command-router.js
// 슬래시 커맨드 vs 자연어 분기 처리

import chalk from "chalk";
import inquirer from "inquirer";
import { statusCommand } from "./commands/status.js";
import { historyCommand } from "./commands/history.js";
import { saveCommand } from "./commands/save.js";
import { loadCommand } from "./commands/load.js";
import { teamCommand } from "./commands/team.js";
import { contextCommand } from "./commands/context.js";
import { helpCommand } from "./commands/help.js";
import { resumeCommand } from "./commands/resume.js";

const COMMAND_MENU = [
  { name: "/resume   — 중단된 파이프라인 재개", value: "/resume" },
  { name: "/status   — 현재 세션 상태", value: "/status" },
  { name: "/context  — 파이프라인 컨텍스트 조회", value: "/context" },
  { name: "/history  — 실행 이력", value: "/history" },
  { name: "/team     — 팀 구성 확인", value: "/team" },
  { name: "/save     — 세션 저장", value: "/save" },
  { name: "/load     — 세션 복원", value: "/load" },
  { name: "/help     — 도움말", value: "/help" },
  { name: "/exit     — 종료", value: "/exit" },
];

export class CommandRouter {
  constructor(replShell) {
    this.replShell = replShell;
  }

  get session() {
    return this.replShell.session;
  }

  /**
   * 입력을 라우팅
   * @param {string} input
   * @returns {Promise<"continue"|"exit">}
   */
  async route(input) {
    const trimmed = input.trim();
    if (!trimmed) return "continue";

    if (trimmed.startsWith("/")) {
      return this.handleSlash(trimmed);
    }
    return this.handleNatural(trimmed);
  }

  async handleSlash(input) {
    // "/" 만 입력 → 커맨드 메뉴 표시
    if (input === "/") {
      const { cmd } = await inquirer.prompt([{
        type: "list",
        name: "cmd",
        message: "커맨드 선택:",
        choices: [...COMMAND_MENU, { name: chalk.gray("취소"), value: null }],
      }]);
      if (!cmd) return "continue";
      input = cmd;
    }

    const [cmd, ...argParts] = input.split(/\s+/);
    const args = argParts.join(" ").trim() || null;

    switch (cmd.toLowerCase()) {
      case "/status":
        statusCommand(this.session);
        break;
      case "/history":
        historyCommand(this.session);
        break;
      case "/save":
        saveCommand(this.session, args);
        break;
      case "/load":
        loadCommand(this.session, args, this.replShell);
        break;
      case "/team":
        teamCommand(this.session);
        break;
      case "/context":
        contextCommand(this.session);
        break;
      case "/resume":
        await resumeCommand(this.session, this.replShell);
        break;
      case "/help":
        helpCommand();
        break;
      case "/exit":
      case "/quit":
        return "exit";
      default:
        console.log(chalk.yellow(`  알 수 없는 커맨드: ${cmd}`));
        console.log(chalk.gray("  /help 로 사용 가능한 커맨드를 확인하세요."));
    }
    return "continue";
  }

  async handleNatural(input) {
    console.log(chalk.bold.cyan("\n🤖 Agent Team 파이프라인 시작\n"));

    try {
      await this.session.runPipeline(input);
    } catch (error) {
      console.log(chalk.red(`\n❌ 파이프라인 실행 실패: ${error.message}`));
    }

    return "continue";
  }
}
