import chalk from "chalk";

export function helpCommand() {
  console.log(chalk.bold("\n  🤖 Agent Team REPL 도움말\n"));
  console.log(chalk.bold("  슬래시 커맨드:"));
  console.log("  /status       현재 세션 상태");
  console.log("  /history      실행 이력 조회");
  console.log("  /team         팀 구성 확인");
  console.log("  /context      SharedContext 슬롯 조회");
  console.log("  /save         세션 저장");
  console.log("  /load [id]    세션 복원 (인자 없으면 목록)");
  console.log("  /help         이 도움말");
  console.log("  /exit         REPL 종료 (자동 저장)\n");
  console.log(chalk.bold("  자연어 입력:"));
  console.log("  요구사항을 자연어로 입력하면 전체 파이프라인이 실행됩니다.");
  console.log(chalk.gray('  예: "사용자 인증 시스템을 만들어줘"\n'));
}
