import chalk from "chalk";
import { t } from "../../i18n/index.js";

export function saveCommand(session) {
  try {
    const filePath = session.save();
    console.log(chalk.green(`  ${t("repl.save.saved", { path: filePath })}`));
    console.log(chalk.gray(`  ${t("repl.save.sessionId", { id: session.id })}`));
  } catch (error) {
    console.log(chalk.red(`  ${t("repl.save.failed", { message: error.message })}`));
  }
}
