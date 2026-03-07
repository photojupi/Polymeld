// src/repl/command-router.js
// 슬래시 커맨드 vs 자연어 분기 처리

import chalk from "chalk";
import { search } from "@inquirer/prompts";
import { statusCommand } from "./commands/status.js";
import { historyCommand } from "./commands/history.js";
import { saveCommand } from "./commands/save.js";
import { loadCommand } from "./commands/load.js";
import { teamCommand } from "./commands/team.js";
import { contextCommand } from "./commands/context.js";
import { helpCommand } from "./commands/help.js";
import { resumeCommand } from "./commands/resume.js";
import { t } from "../i18n/index.js";

function getCommandMenu() {
  return [
    { name: `/resume   — ${t("repl.commandMenu.resume")}`, value: "/resume" },
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
      const menu = getCommandMenu();
      const cmd = await search({
        message: "/",
        source: (term) => {
          if (!term) return menu;
          const lower = term.toLowerCase();
          return menu.filter(c =>
            c.value.includes(lower) || c.name.toLowerCase().includes(lower)
          );
        },
      });
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
