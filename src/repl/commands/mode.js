import chalk from "chalk";
import { t } from "../../i18n/index.js";
import { SlashMenu } from "../slash-menu.js";

const MODES = ["full-auto", "semi-auto", "manual"];

export async function modeCommand(session, args) {
  if (!session.config.pipeline) session.config.pipeline = {};
  const current = session.config.pipeline.interaction_mode || "semi-auto";

  if (!args) {
    const items = MODES.map(m => ({
      name: m === current ? `${m}  ✓` : m,
      value: m,
    }));
    const selected = await new SlashMenu(items).show();
    if (!selected || selected === current) return;
    args = selected;
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
