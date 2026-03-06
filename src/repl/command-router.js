// src/repl/command-router.js
// 슬래시 커맨드 vs 자연어 분기 처리

import chalk from "chalk";
import { statusCommand } from "./commands/status.js";
import { historyCommand } from "./commands/history.js";
import { saveCommand } from "./commands/save.js";
import { loadCommand } from "./commands/load.js";
import { teamCommand } from "./commands/team.js";
import { contextCommand } from "./commands/context.js";
import { helpCommand } from "./commands/help.js";
import { resumeCommand } from "./commands/resume.js";

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
