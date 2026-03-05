import chalk from "chalk";
import { SessionStore } from "../../session/session-store.js";
import { Session } from "../../session/session.js";

export function loadCommand(session, args, replShell) {
  const store = new SessionStore();

  if (!args) {
    const sessions = store.list();
    if (sessions.length === 0) {
      console.log(chalk.gray("  저장된 세션이 없습니다."));
      return;
    }
    console.log(chalk.bold("\n  💾 저장된 세션 목록\n"));
    for (const s of sessions) {
      const current = s.id === session.id ? chalk.cyan(" (현재)") : "";
      console.log(`  ${s.id} - ${s.updatedAt.split("T")[0]}${current}`);
    }
    console.log(chalk.gray(`\n  복원: /load <세션ID>`));
    return;
  }

  const data = store.load(args);
  if (!data) {
    console.log(chalk.red(`  ❌ 세션을 찾을 수 없습니다: ${args}`));
    return;
  }

  const restored = Session.fromJSON(data, session.config);
  replShell.session = restored;
  console.log(chalk.green(`  ✅ 세션 복원됨: ${args}`));
  console.log(chalk.gray(`  실행 이력: ${restored.runs.length}회`));
}
