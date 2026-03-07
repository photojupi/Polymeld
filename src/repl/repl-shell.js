// src/repl/repl-shell.js
// 인터랙티브 REPL 셸 - readline 기반 프롬프트 루프

import readline from "readline";
import chalk from "chalk";
import { Session } from "../session/session.js";
import { SessionStore } from "../session/session-store.js";
import { CommandRouter } from "./command-router.js";
import { StatusBar } from "./status-bar.js";
import { PasteDetectStream } from "./paste-detect-stream.js";
import { t } from "../i18n/index.js";

export class ReplShell {
  constructor(config) {
    this.config = config;
    this.session = new Session(config);
    this.router = new CommandRouter(this);
    this.statusBar = new StatusBar(this);
    this.rl = null;
    this.pasteStream = null;
    this._running = false;
    this._exiting = false;
    this._cleanupBracketedPaste = null;
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
        console.log(chalk.yellow(`  ${t("repl.noSavedSession")}`));
        return;
      }
      id = sessions[0].id;
    }

    const data = store.load(id);
    if (!data) {
      console.log(chalk.yellow(`  ${t("repl.sessionNotFound", { id })}`));
      return;
    }

    this.session = Session.fromJSON(data, this.config);
    console.log(chalk.green(`  ${t("repl.sessionRestored", { id, count: this.session.runs.length })}\n`));
  }

  /**
   * REPL 메인 루프
   */
  async start() {
    this._printBanner();
    this._running = true;

    // TTY인 경우 Bracketed Paste Mode 활성화
    let inputStream = process.stdin;
    if (process.stdin.isTTY) {
      this.pasteStream = new PasteDetectStream(process.stdin);
      process.stdin.pipe(this.pasteStream);
      inputStream = this.pasteStream;

      process.stdout.write("\x1b[?2004h");
      const cleanup = () => process.stdout.write("\x1b[?2004l");
      process.on("exit", cleanup);
      this._cleanupBracketedPaste = cleanup;
    }

    const commands = ["/status", "/history", "/save", "/load", "/team", "/context", "/resume", "/help", "/exit", "/quit"];
    this.rl = readline.createInterface({
      input: inputStream,
      output: process.stdout,
      completer: (line) => {
        if (!line.startsWith("/")) return [[], line];
        const hits = commands.filter(c => c.startsWith(line));
        return [hits, line];
      },
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
        console.log(chalk.red(`  ${t("repl.error", { message: error.message })}`));
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

    this.statusBar.print();

    const keypressSource = this.pasteStream || process.stdin;

    return new Promise((resolve) => {
      let timer = null;
      let pastedContent = null;

      const onKeypress = () => {
        if (this.rl.line === "/") {
          clearTimeout(timer);
          timer = setTimeout(() => {
            if (this.rl.line === "/") {
              keypressSource.removeListener("keypress", onKeypress);
              this.rl.write("\n");
            }
          }, 80);
        }
      };
      keypressSource.on("keypress", onKeypress);

      const onPaste = (content) => {
        const cleaned = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

        // 단일 줄 붙여넣기는 일반 타이핑처럼 처리
        if (!cleaned.includes("\n")) {
          this.rl.write(cleaned);
          return;
        }

        // 여러 줄 붙여넣기
        const typedPrefix = this.rl.line || "";
        pastedContent = typedPrefix + cleaned;

        // 시각 피드백
        const lines = cleaned.split("\n");
        if (lines.length <= 5) {
          console.log(chalk.gray(`\n  ${t("repl.pasteLines", { count: lines.length })}`));
          for (const line of lines) {
            console.log(chalk.gray(`  │ ${line}`));
          }
        } else {
          console.log(chalk.gray(`\n  ${t("repl.pasteLines", { count: lines.length })}`));
          console.log(chalk.gray(`  │ ${lines[0]}`));
          console.log(chalk.gray(`  │ ${lines[1]}`));
          console.log(chalk.gray(`  │ ${t("repl.pasteOmitted", { count: lines.length - 4 })}`));
          console.log(chalk.gray(`  │ ${lines[lines.length - 2]}`));
          console.log(chalk.gray(`  │ ${lines[lines.length - 1]}`));
        }

        // readline question 강제 완료
        this.rl.write("\n");
      };

      if (this.pasteStream) {
        this.pasteStream.once("paste", onPaste);
      }

      const onClose = () => resolve(null);
      this.rl.once("close", onClose);

      this.rl.question(promptStr, (answer) => {
        clearTimeout(timer);
        keypressSource.removeListener("keypress", onKeypress);
        this.rl.removeListener("close", onClose);
        if (this.pasteStream) {
          this.pasteStream.removeListener("paste", onPaste);
        }
        resolve(pastedContent ?? answer);
      });
    });
  }

  _printBanner() {
    console.log(chalk.bold.cyan(`\n${t("repl.banner")}\n`));
    console.log(chalk.gray(`  ${t("repl.bannerDesc")}`));
    console.log(chalk.gray(`  ${t("repl.bannerHelp")}\n`));

    // 팀 구성 간략 출력
    const personas = this.config.personas;
    const names = Object.values(personas).map(p => p.name).join(", ");
    console.log(chalk.gray(`  ${t("repl.teamMembers", { names })}\n`));
  }

  _handleExit() {
    if (this._exiting) return; // 이중 호출 방지
    this._exiting = true;
    this._running = false;

    // Bracketed Paste Mode 비활성화 및 스트림 정리
    if (this._cleanupBracketedPaste) {
      process.stdout.write("\x1b[?2004l");
      process.removeListener("exit", this._cleanupBracketedPaste);
      this._cleanupBracketedPaste = null;
    }
    if (this.pasteStream) {
      process.stdin.unpipe(this.pasteStream);
      this.pasteStream.destroy();
      this.pasteStream = null;
    }

    // 자동 저장
    if (this.session.runs.length > 0) {
      try {
        const filePath = this.session.save();
        console.log(chalk.gray(`\n  ${t("repl.autoSaved", { path: filePath })}`));
      } catch (e) {
        console.log(chalk.yellow(`\n  ${t("repl.saveFailed", { message: e.message })}`));
      }
    }

    console.log(chalk.gray(`  ${t("repl.exit")}\n`));

    if (this.rl) {
      this.rl.close();
    }
  }
}
