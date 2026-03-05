import chalk from "chalk";

export function statusCommand(session) {
  const runs = session.runs;
  if (runs.length === 0) {
    console.log(chalk.gray("  아직 실행 이력이 없습니다. 자연어로 요구사항을 입력하세요."));
    return;
  }

  const last = runs[runs.length - 1];
  console.log(chalk.bold("\n  📋 세션 상태\n"));
  console.log(`  세션 ID: ${chalk.cyan(session.id)}`);
  console.log(`  총 실행: ${runs.length}회`);
  console.log(`  마지막: ${chalk.bold(last.title)} (${last.status})`);

  const slotCount = session.sharedContext.slots.size;
  const msgCount = session.mailbox.allMessages.length;
  console.log(`  SharedContext: ${slotCount}개 슬롯`);
  console.log(`  Mailbox: ${msgCount}개 메시지\n`);
}
