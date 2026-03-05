import chalk from "chalk";

export function historyCommand(session) {
  const runs = session.runs;
  if (runs.length === 0) {
    console.log(chalk.gray("  실행 이력이 없습니다."));
    return;
  }

  console.log(chalk.bold("\n  📜 실행 이력\n"));
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const icon = run.status === "completed" ? "✅" : run.status === "failed" ? "❌" : "🔄";
    const time = run.startedAt?.split("T")[1]?.split(".")[0] || "";
    console.log(`  ${i + 1}. ${icon} ${run.title} (${time}) [${run.status}]`);
  }
  console.log();
}
