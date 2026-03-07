import chalk from "chalk";
import { SessionStore } from "../../session/session-store.js";
import { Session } from "../../session/session.js";
import { t } from "../../i18n/index.js";

export function loadCommand(session, args, replShell) {
  const store = new SessionStore();

  if (!args) {
    const sessions = store.list();
    if (sessions.length === 0) {
      console.log(chalk.gray(`  ${t("repl.load.noSessions")}`));
      return;
    }
    console.log(chalk.bold(`\n  ${t("repl.load.header")}\n`));
    for (const s of sessions) {
      const current = s.id === session.id ? chalk.cyan(t("repl.load.current")) : "";
      console.log(`  ${s.id} - ${s.updatedAt.split("T")[0]}${current}`);
    }
    console.log(chalk.gray(`\n  ${t("repl.load.loadHint")}`));
    return;
  }

  const data = store.load(args);
  if (!data) {
    console.log(chalk.red(`  ${t("repl.load.notFound", { id: args })}`));
    return;
  }

  const restored = Session.fromJSON(data, session.config);
  replShell.session = restored;
  console.log(chalk.green(`  ${t("repl.load.restored", { id: args })}`));
  console.log(chalk.gray(`  ${t("repl.load.runHistory", { count: restored.runs.length })}`));
}
