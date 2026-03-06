import chalk from "chalk";
import inquirer from "inquirer";
import { SessionStore } from "../../session/session-store.js";
import { Session } from "../../session/session.js";

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

export async function resumeCommand(session, replShell) {
  // 현재 세션에 재개할 데이터가 있으면 바로 재개
  if (session.state.project.requirement) {
    return _resumeCurrentSession(session);
  }

  // 없으면 저장된 세션 목록에서 선택
  const store = new SessionStore();
  const sessions = store.list();

  if (sessions.length === 0) {
    console.log(chalk.yellow("  저장된 세션이 없습니다. 먼저 프로젝트를 실행해주세요."));
    return;
  }

  // 세션 목록에 제목/Phase 정보 포함
  const loaded = new Map();
  const choices = sessions.map(s => {
    const data = store.load(s.id);
    loaded.set(s.id, data);
    const title = data?.state?.project?.title || "(제목 없음)";
    const phases = data?.state?.completedPhases || [];
    const phaseInfo = phases.length > 0
      ? `${phases.length}단계 완료`
      : "시작 전";
    const date = s.updatedAt.split("T")[0];
    return {
      name: `${title}  ${chalk.gray(`— ${phaseInfo} · ${date} · ${s.id}`)}`,
      value: s.id,
    };
  });
  choices.push({ name: chalk.gray("취소"), value: null });

  const { selected } = await inquirer.prompt([{
    type: "list",
    name: "selected",
    message: "재개할 세션을 선택하세요:",
    choices,
  }]);

  if (!selected) return;

  // 선택한 세션 로드
  const restored = Session.fromJSON(loaded.get(selected), session.config);
  replShell.session = restored;
  console.log(chalk.green(`  ✅ 세션 복원: ${selected}\n`));

  return _resumeCurrentSession(restored);
}

async function _resumeCurrentSession(session) {
  const { title } = session.state.project;
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
