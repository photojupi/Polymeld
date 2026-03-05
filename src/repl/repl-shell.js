// src/repl/repl-shell.js
// 인터랙티브 REPL 셸 - readline 기반 프롬프트 루프

import readline from "readline";
import chalk from "chalk";
import { Session } from "../session/session.js";
import { SessionStore } from "../session/session-store.js";
import { CommandRouter } from "./command-router.js";

export class ReplShell {
  constructor(config) {
    this.config = config;
    this.session = new Session(config);
    this.router = new CommandRouter(this);
    this.rl = null;
    this._running = false;
    this._exiting = false;
  }

  /**
   * 저장된 세션 복원
   */
  loadSession(id) {
    const store = new SessionStore();

    // id가 true (--resume 플래그만 준 경우) → 최신 세션 로드
    if (id === true) {
      const sessions = store.list();
      if (sessions.length === 0) {
        console.log(chalk.yellow("  저장된 세션이 없습니다. 새 세션을 시작합니다."));
        return;
      }
      id = sessions[0].id;
    }

    const data = store.load(id);
    if (!data) {
      console.log(chalk.yellow(`  세션 ${id}를 찾을 수 없습니다. 새 세션을 시작합니다.`));
      return;
    }

    this.session = Session.fromJSON(data, this.config);
    console.log(chalk.green(`  ✅ 세션 복원: ${id} (실행 ${this.session.runs.length}회)\n`));
  }

  /**
   * REPL 메인 루프
   */
  async start() {
    this._printBanner();
    this._running = true;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Ctrl+C 핸들링
    this.rl.on("close", () => {
      if (this._running && !this._exiting) {
        this._handleExit();
      }
    });

    while (this._running) {
      const input = await this._prompt();
      if (input === null) break; // EOF / readline closed

      // readline을 pause하여 inquirer와의 충돌 방지
      // (파이프라인 실행 중 InteractionManager가 inquirer를 사용함)
      this.rl.pause();
      try {
        const result = await this.router.route(input);
        if (result === "exit") {
          break;
        }
      } catch (error) {
        console.log(chalk.red(`  오류: ${error.message}`));
      } finally {
        if (this._running) {
          this.rl.resume();
        }
      }
    }

    this._handleExit();
  }

  _prompt() {
    const lastTitle = this.session.lastRunTitle;
    const prefix = lastTitle
      ? chalk.gray(`[${lastTitle.substring(0, 20)}] `)
      : "";
    const promptStr = `${prefix}${chalk.bold.green(">")} `;

    return new Promise((resolve) => {
      this.rl.question(promptStr, (answer) => {
        resolve(answer);
      });
      // readline close 시 null 반환하여 루프 종료
      this.rl.once("close", () => resolve(null));
    });
  }

  _printBanner() {
    console.log(chalk.bold.cyan("\n🤖 Agent Team CLI v0.1.0 - Interactive Mode\n"));
    console.log(chalk.gray("  요구사항을 자연어로 입력하면 전체 파이프라인이 실행됩니다."));
    console.log(chalk.gray("  /help 로 사용 가능한 커맨드를 확인하세요.\n"));

    // 팀 구성 간략 출력
    const personas = this.config.personas;
    const alwaysOn = Object.entries(personas).filter(([, p]) => !p.on_demand);
    const onDemand = Object.entries(personas).filter(([, p]) => p.on_demand);
    console.log(chalk.gray(`  상시 투입: ${alwaysOn.map(([, p]) => p.name).join(", ")}`));
    console.log(chalk.gray(`  온디맨드: ${onDemand.map(([, p]) => p.name).join(", ")}\n`));
  }

  _handleExit() {
    if (this._exiting) return; // 이중 호출 방지
    this._exiting = true;
    this._running = false;

    // 자동 저장
    if (this.session.runs.length > 0) {
      try {
        const filePath = this.session.save();
        console.log(chalk.gray(`\n  💾 세션 자동 저장: ${filePath}`));
      } catch (e) {
        console.log(chalk.yellow(`\n  ⚠️ 세션 저장 실패: ${e.message}`));
      }
    }

    console.log(chalk.gray("  👋 Agent Team REPL 종료\n"));

    if (this.rl) {
      this.rl.close();
    }
  }
}
