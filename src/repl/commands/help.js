import chalk from "chalk";
import { t } from "../../i18n/index.js";

export function helpCommand() {
  console.log(chalk.bold(`\n  ${t("repl.help.header")}\n`));
  console.log(chalk.bold(`  ${t("repl.help.slashCommands")}`));
  console.log(`  /status       ${t("repl.help.cmdStatus")}`);
  console.log(`  /history      ${t("repl.help.cmdHistory")}`);
  console.log(`  /team         ${t("repl.help.cmdTeam")}`);
  console.log(`  /context      ${t("repl.help.cmdContext")}`);
  console.log(`  /save         ${t("repl.help.cmdSave")}`);
  console.log(`  /load [id]    ${t("repl.help.cmdLoad")}`);
  console.log(`  /resume       ${t("repl.help.cmdResume")}`);
  console.log(`  /help         ${t("repl.help.cmdHelp")}`);
  console.log(`  /exit         ${t("repl.help.cmdExit")}\n`);
  console.log(chalk.bold(`  ${t("repl.help.naturalInput")}`));
  console.log(`  ${t("repl.help.naturalDesc")}`);
  console.log(chalk.gray(`  ${t("repl.help.naturalExample")}\n`));
}
