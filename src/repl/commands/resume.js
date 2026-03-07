import chalk from "chalk";
import inquirer from "inquirer";
import { SessionStore } from "../../session/session-store.js";
import { Session } from "../../session/session.js";
import { t } from "../../i18n/index.js";

export async function resumeCommand(session, replShell) {
  // 현재 세션에 재개할 데이터가 있으면 바로 재개
  if (session.state.project.requirement) {
    return _resumeCurrentSession(session);
  }

  // 없으면 저장된 세션 목록에서 선택
  const store = new SessionStore();
  const sessions = store.list();

  if (sessions.length === 0) {
    console.log(chalk.yellow(`  ${t("repl.resume.noSessions")}`));
    return;
  }

  // 세션 목록에 제목/Phase 정보 포함
  const loaded = new Map();
  const choices = sessions.map(s => {
    const data = store.load(s.id);
    loaded.set(s.id, data);
    const title = data?.state?.project?.title || t("repl.resume.noTitle");
    const phases = data?.state?.completedPhases || [];
    const phaseInfo = phases.length > 0
      ? t("repl.resume.phasesCompleted", { count: phases.length })
      : t("repl.resume.notStarted");
    const date = s.updatedAt.split("T")[0];
    return {
      name: `${title}  ${chalk.gray(`— ${phaseInfo} · ${date} · ${s.id}`)}`,
      value: s.id,
    };
  });
  choices.push({ name: chalk.gray(t("repl.resume.cancel")), value: null });

  const { selected } = await inquirer.prompt([{
    type: "list",
    name: "selected",
    message: t("repl.resume.selectSession"),
    choices,
  }]);

  if (!selected) return;

  // 선택한 세션 로드
  const restored = Session.fromJSON(loaded.get(selected), session.config);
  replShell.session = restored;
  console.log(chalk.green(`  ${t("repl.resume.restored", { id: selected })}\n`));

  return _resumeCurrentSession(restored);
}

async function _resumeCurrentSession(session) {
  const { title } = session.state.project;
  const completed = session.state.completedPhases;

  if (completed.length === 0) {
    console.log(chalk.yellow(`  ${t("repl.resume.noPhasesCompleted")}`));
  } else {
    console.log(chalk.bold(`\n  ${t("repl.resume.resuming", { title })}\n`));
    console.log(chalk.green(`  ${t("repl.resume.completedPhases")}`));
    for (const id of completed) {
      console.log(chalk.green(`    ✅ ${t("repl.resume.phaseLabels." + id)}`));
    }
    console.log();
  }

  try {
    await session.resumePipeline();
  } catch (error) {
    console.log(chalk.red(`\n${t("repl.resume.resumeFailed", { message: error.message })}`));
  }
}
