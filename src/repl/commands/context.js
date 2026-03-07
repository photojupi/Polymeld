import chalk from "chalk";
import { t } from "../../i18n/index.js";

export function contextCommand(session) {
  const state = session.state;

  const fields = [
    ["project.title", state.project.title],
    ["project.requirement", state.project.requirement],
    ["kickoffSummary", state.kickoffSummary],
    ["designDecisions", state.designDecisions],
    ["techStack", state.techStack],
    ["tasks", `${state.tasks.length}`],
    ["completedTasks", `${state.completedTasks.length}`],
    ["messages", `${state.messages.length}`],
  ];

  const hasData = fields.some(([, v]) => v && v !== "0");
  if (!hasData) {
    console.log(chalk.gray(`  ${t("repl.context.empty")}`));
    return;
  }

  console.log(chalk.bold(`\n  ${t("repl.context.header")}\n`));
  for (const [name, value] of fields) {
    const preview = String(value || "").substring(0, 60);
    console.log(`  ${chalk.cyan(name)}: ${preview}${preview.length >= 60 ? "..." : ""}`);
  }
  console.log();
}
