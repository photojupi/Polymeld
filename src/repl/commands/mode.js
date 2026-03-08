import chalk from "chalk";
import { t } from "../../i18n/index.js";

const MODES = ["full-auto", "semi-auto", "manual"];

export function modeCommand(session, args) {
  if (!session.config.pipeline) session.config.pipeline = {};
  const current = session.config.pipeline.interaction_mode || "semi-auto";

  if (!args) {
    console.log(`\n  ${t("repl.mode.current", { mode: current })}`);
    console.log(chalk.gray(`  ${t("repl.mode.usage")}\n`));
    return;
  }

  if (!MODES.includes(args)) {
    console.log(chalk.red(`  ${t("repl.mode.unknown", { mode: args })}`));
    console.log(chalk.gray(`  ${t("repl.mode.available", { modes: MODES.join(", ") })}`));
    return;
  }

  if (args === current) {
    console.log(chalk.gray(`  ${t("repl.mode.already", { mode: args })}`));
    return;
  }

  session.config.pipeline.interaction_mode = args;
  console.log(chalk.cyan(`  ${t("config.modeChanged", { from: current, to: args })}`));
}
