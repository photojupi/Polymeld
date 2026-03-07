import chalk from "chalk";
import { t } from "../../i18n/index.js";

export function historyCommand(session) {
  const runs = session.runs;
  if (runs.length === 0) {
    console.log(chalk.gray(`  ${t("repl.history.noHistory")}`));
    return;
  }

  console.log(chalk.bold(`\n  ${t("repl.history.header")}\n`));
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const icon = run.status === "completed" ? "✅" : run.status === "failed" ? "❌" : "🔄";
    const time = run.startedAt?.split("T")[1]?.split(".")[0] || "";
    console.log(`  ${i + 1}. ${icon} ${run.title} (${time}) [${run.status}]`);
  }
  console.log();
}
