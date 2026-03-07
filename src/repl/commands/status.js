import chalk from "chalk";
import { t } from "../../i18n/index.js";

export function statusCommand(session) {
  const runs = session.runs;
  if (runs.length === 0) {
    console.log(chalk.gray(`  ${t("repl.status.noHistory")}`));
    return;
  }

  const last = runs[runs.length - 1];
  console.log(chalk.bold(`\n  ${t("repl.status.header")}\n`));
  console.log(`  ${t("repl.status.sessionId", { id: session.id })}`);
  console.log(`  ${t("repl.status.totalRuns", { count: runs.length })}`);
  console.log(`  ${t("repl.status.lastRun", { title: last.title, status: last.status })}`);

  const taskCount = session.state.tasks.length;
  const msgCount = session.state.messages.length;
  console.log(`  ${t("repl.status.taskCount", { count: taskCount })}`);
  console.log(`  ${t("repl.status.messageCount", { count: msgCount })}\n`);
}
