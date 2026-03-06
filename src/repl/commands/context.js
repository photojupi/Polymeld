import chalk from "chalk";

export function contextCommand(session) {
  const state = session.state;

  const fields = [
    ["project.title", state.project.title],
    ["project.requirement", state.project.requirement],
    ["kickoffSummary", state.kickoffSummary],
    ["designDecisions", state.designDecisions],
    ["techStack", state.techStack],
    ["tasks", `${state.tasks.length}개`],
    ["completedTasks", `${state.completedTasks.length}개`],
    ["messages", `${state.messages.length}개`],
  ];

  const hasData = fields.some(([, v]) => v && v !== "0개" && v !== "(없음)");
  if (!hasData) {
    console.log(chalk.gray("  PipelineState가 비어있습니다."));
    return;
  }

  console.log(chalk.bold("\n  🧠 PipelineState\n"));
  for (const [name, value] of fields) {
    const preview = String(value || "").substring(0, 60);
    console.log(`  ${chalk.cyan(name)}: ${preview}${preview.length >= 60 ? "..." : ""}`);
  }
  console.log();
}
