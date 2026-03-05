import chalk from "chalk";

export function saveCommand(session) {
  try {
    const filePath = session.save();
    console.log(chalk.green(`  ✅ 세션 저장됨: ${filePath}`));
    console.log(chalk.gray(`  세션 ID: ${session.id}`));
  } catch (error) {
    console.log(chalk.red(`  ❌ 저장 실패: ${error.message}`));
  }
}
