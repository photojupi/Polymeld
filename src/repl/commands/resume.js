import chalk from "chalk";

const PHASE_LABELS = {
  codebaseAnalysis: "코드베이스 분석",
  kickoff: "킥오프 미팅",
  design: "기술 설계 미팅",
  taskBreakdown: "태스크 분해",
  assignment: "작업 분배",
  development: "개발",
  codeReview: "코드 리뷰",
  qa: "QA",
  pr: "PR 생성",
};

export async function resumeCommand(session) {
  const { requirement, title } = session.state.project;
  if (!requirement) {
    console.log(chalk.yellow("  재개할 파이프라인이 없습니다. 먼저 프로젝트를 실행해주세요."));
    return;
  }

  const completed = session.state.completedPhases;
  if (completed.length === 0) {
    console.log(chalk.yellow("  완료된 Phase가 없습니다. 처음부터 실행됩니다."));
  } else {
    console.log(chalk.bold(`\n  ⏯️  "${title}" 파이프라인 재개\n`));
    console.log(chalk.green("  완료된 Phase:"));
    for (const id of completed) {
      console.log(chalk.green(`    ✅ ${PHASE_LABELS[id] || id}`));
    }
    console.log();
  }

  try {
    await session.resumePipeline();
  } catch (error) {
    console.log(chalk.red(`\n❌ 파이프라인 재개 실패: ${error.message}`));
  }
}
