// src/repl/command-router.js
// 슬래시 커맨드 vs 자연어 분기 처리

import chalk from "chalk";
import { SlashMenu } from "./slash-menu.js";
import { statusCommand } from "./commands/status.js";
import { historyCommand } from "./commands/history.js";
import { saveCommand } from "./commands/save.js";
import { loadCommand } from "./commands/load.js";
import { teamCommand } from "./commands/team.js";
import { contextCommand } from "./commands/context.js";
import { helpCommand } from "./commands/help.js";
import { resumeCommand } from "./commands/resume.js";
import { modeCommand } from "./commands/mode.js";
import { t } from "../i18n/index.js";

function getCommandMenu() {
  return [
    { name: `/resume   — ${t("repl.commandMenu.resume")}`, value: "/resume" },
    { name: `/mode     — ${t("repl.commandMenu.mode")}`, value: "/mode" },
    { name: `/status   — ${t("repl.commandMenu.status")}`, value: "/status" },
    { name: `/context  — ${t("repl.commandMenu.context")}`, value: "/context" },
    { name: `/history  — ${t("repl.commandMenu.history")}`, value: "/history" },
    { name: `/team     — ${t("repl.commandMenu.team")}`, value: "/team" },
    { name: `/save     — ${t("repl.commandMenu.save")}`, value: "/save" },
    { name: `/load     — ${t("repl.commandMenu.load")}`, value: "/load" },
    { name: `/help     — ${t("repl.commandMenu.help")}`, value: "/help" },
    { name: `/exit     — ${t("repl.commandMenu.exit")}`, value: "/exit" },
  ];
}

export class CommandRouter {
  constructor(replShell) {
    this.replShell = replShell;
  }

  get session() {
    return this.replShell.session;
  }

  async route(input) {
    const trimmed = input.trim();
    if (!trimmed) return "continue";

    if (trimmed.startsWith("/")) {
      return this.handleSlash(trimmed);
    }
    return this.handleNatural(trimmed);
  }

  async handleSlash(input) {
    if (input === "/") {
      // readline이 "/" 제출로 남긴 두 줄(프롬프트 줄, 그 위의 상태바 줄)을 소거한다.
      // \x1b[A = 커서 1줄 위로, \x1b[2K = 현재 줄 전체 삭제, \r = 줄 시작으로 이동
      process.stdout.write("\x1b[A\x1b[2K\x1b[A\x1b[2K\r");

      const cmd = await new SlashMenu(getCommandMenu()).show();
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
      case "/mode":
        await modeCommand(this.session, args);
        break;
      case "/help":
        helpCommand();
        break;
      case "/exit":
      case "/quit":
        return "exit";
      default:
        console.log(chalk.yellow(`  ${t("repl.unknownCommand", { cmd })}`));
        console.log(chalk.gray(`  ${t("repl.unknownCommandHelp")}`));
    }
    return "continue";
  }

  async handleNatural(input) {
    console.log(chalk.bold.cyan(`\n${t("repl.pipelineStart")}\n`));

    try {
      await this.session.runPipeline(input);
    } catch (error) {
      console.log(chalk.red(`\n${t("repl.pipelineFailed", { message: error.message })}`));
    }

    return "continue";
  }
}
