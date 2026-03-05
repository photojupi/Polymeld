// src/models/adapter.js
// CLI 기반 멀티 AI 모델 통합 어댑터
// Claude Code, Gemini CLI, Codex CLI를 서브프로세스로 호출

import { spawn, execFileSync } from "child_process";
import os from "os";

/**
 * CLI 실행 오류를 구조화하여 표현하는 커스텀 에러 클래스.
 * CLI별 종료 코드를 카테고리로 분류하고, 재시도 가능 여부를 판단한다.
 */
export class CliError extends Error {
  constructor(cli, exitCode, stderr, stdout) {
    const message = CliError._buildMessage(cli, exitCode, stderr, stdout);
    super(message);
    this.name = "CliError";
    this.cli = cli;
    this.exitCode = exitCode;
    this.stderr = stderr;
    this.stdout = stdout;
    this.category = CliError._categorize(cli, exitCode);
  }

  /**
   * CLI 이름과 종료 코드를 기반으로 에러 카테고리를 분류한다.
   */
  static _categorize(cli, code) {
    // Gemini 고유 종료 코드
    if (cli === "gemini") {
      if (code === 41) return "auth";
      if (code === 42) return "input";
      if (code === 44) return "sandbox";
      if (code === 52) return "config";
      if (code === 53) return "turn_limit";
    }
    // Claude 고유 종료 코드
    if (cli === "claude" && code === 2) return "blocking";
    // 일반 분류
    if (code === 1) return "runtime";
    return "unknown";
  }

  /**
   * 사용자에게 표시할 에러 메시지를 생성한다.
   */
  static _buildMessage(cli, code, stderr, stdout) {
    const output = (stderr || stdout || "(출력 없음)").substring(0, 500);
    return `[${cli}] CLI 오류 (exit ${code}): ${output}`;
  }

  /**
   * 재시도 가능한 에러인지 여부를 반환한다.
   * runtime, unknown 카테고리만 재시도 가능으로 판단.
   */
  get isRetryable() {
    return ["runtime", "unknown"].includes(this.category);
  }
}

export class ModelAdapter {
  constructor(config) {
    this.config = config;
    this._availableCache = null;
  }

  /**
   * CLI 서브프로세스 실행 (stdin 방식)
   * shell: true로 Windows .cmd/.ps1 호환
   * options.timeout: 타임아웃 밀리초 (기본 5분, 0이면 무제한)
   */
  _spawnCli(command, args, stdinData, options = {}) {
    const timeout =
      options.timeout || this.config.cli?.timeout || 300000; // 기본 5분

    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
        env: { ...process.env },
      });

      let stdout = "";
      let stderr = "";
      let killed = false;

      // 타임아웃 타이머 (0이면 무제한)
      let timer = null;
      if (timeout > 0) {
        timer = setTimeout(() => {
          killed = true;
          proc.kill("SIGTERM");
          // SIGTERM 후 5초 대기, 여전히 살아있으면 SIGKILL
          setTimeout(() => {
            if (!proc.killed) proc.kill("SIGKILL");
          }, 5000);
          reject(
            new CliError(command, -1, `타임아웃 (${timeout / 1000}초 초과)`, stdout.substring(0, 200))
          );
        }, timeout);
      }

      proc.stdout.on("data", (d) => (stdout += d.toString()));
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("error", (err) => {
        if (timer) clearTimeout(timer);
        reject(new Error(`CLI 실행 실패 (${command}): ${err.message}`));
      });
      proc.on("close", (code) => {
        if (timer) clearTimeout(timer);
        if (killed) return; // 이미 타임아웃으로 reject됨
        if (code !== 0) {
          reject(new CliError(command, code, stderr, stdout));
        } else {
          resolve(stdout.trim());
        }
      });

      if (stdinData) proc.stdin.write(stdinData);
      proc.stdin.end();
    });
  }

  /**
   * CLI 출력에서 잡음을 제거하고 순수 텍스트를 추출한다.
   * - ANSI 이스케이프 코드 제거
   * - CLI별 진행률/헤더 등 불필요한 출력 제거
   */
  _normalizeOutput(raw, cli) {
    let text = raw;

    // 1. ANSI 이스케이프 코드 제거
    text = text.replace(
      // eslint-disable-next-line no-control-regex
      /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
      ""
    );

    // 2. CLI별 잡음 제거
    if (cli === "codex") {
      // Codex TUI 진행률 표시/헤더 라인 제거
      text = text.replace(/^(Thinking|Executing|Reading).*\n/gm, "");
    }
    if (cli === "gemini") {
      // Gemini 디버그/상태 라인 제거 (━ 등 구분선)
      text = text.replace(/^[━─]+$/gm, "");
    }

    // 3. 선행/후행 공백 정리
    text = text.trim();

    return text;
  }

  /**
   * 시스템 프롬프트 + 사용자 메시지를 합친 프롬프트 생성
   * (Gemini CLI, Codex CLI용 -- system prompt 플래그 미지원)
   */
  _buildCombinedPrompt(systemPrompt, userMessage) {
    return `## 시스템 지침\n${systemPrompt}\n\n---\n\n## 요청\n${userMessage}`;
  }

  /**
   * 지정된 모델로 메시지를 보내고 응답을 받음
   */
  async chat(modelKey, systemPrompt, userMessage, options = {}) {
    const modelConfig = this.config.models[modelKey];
    if (!modelConfig) {
      throw new Error(`모델 설정을 찾을 수 없습니다: ${modelKey}`);
    }

    switch (modelConfig.cli) {
      case "claude":
        return this._chatClaude(modelConfig.model, systemPrompt, userMessage);
      case "gemini":
        return this._chatGemini(modelConfig.model, systemPrompt, userMessage);
      case "codex":
        return this._chatCodex(modelConfig.model, systemPrompt, userMessage);
      default:
        throw new Error(`지원하지 않는 CLI: ${modelConfig.cli}`);
    }
  }

  /**
   * Claude Code: --system-prompt 플래그 지원, stdin으로 메시지 전달
   * --max-turns로 무한 에이전트 루프 방지
   */
  async _chatClaude(model, systemPrompt, userMessage) {
    const args = ["-p", "--output-format", "text"];
    if (model) args.push("--model", model);
    if (systemPrompt) args.push("--system-prompt", systemPrompt);

    // max-turns 제한으로 무한 에이전트 루프 방지
    const maxTurns = this.config.cli?.max_turns?.claude ?? 3;
    args.push("--max-turns", String(maxTurns));

    const raw = await this._spawnCli("claude", args, userMessage, {
      timeout: this.config.cli?.timeouts?.claude,
    });
    return this._normalizeOutput(raw, "claude");
  }

  /**
   * Gemini CLI: stdin pipe로 프롬프트 전달 (안전한 방식)
   * 최신 Gemini CLI(v0.28+)는 stdin/pipe 입력을 정식 지원
   */
  async _chatGemini(model, systemPrompt, userMessage) {
    const prompt = systemPrompt
      ? this._buildCombinedPrompt(systemPrompt, userMessage)
      : userMessage;

    // stdin pipe 방식: 셸 이스케이핑 불필요, 보안 안전
    const args = ["--output-format", "text"];
    if (model) args.push("-m", model);

    const raw = await this._spawnCli("gemini", args, prompt, {
      timeout: this.config.cli?.timeouts?.gemini,
    });
    return this._normalizeOutput(raw, "gemini");
  }

  /**
   * Codex CLI: codex exec + stdin 파이핑
   * -q (quiet): TUI 비활성화
   * --ask-for-approval never: 비대화형에서 승인 프롬프트 방지
   * --skip-git-repo-check: 임의 디렉토리에서 실행 가능
   * --sandbox read-only: 파일 수정 방지
   */
  async _chatCodex(model, systemPrompt, userMessage) {
    const prompt = systemPrompt
      ? this._buildCombinedPrompt(systemPrompt, userMessage)
      : userMessage;

    const args = [
      "exec",
      "--sandbox", "read-only",
      "--skip-git-repo-check",
      "-q",
      "--ask-for-approval", "never",
    ];

    const raw = await this._spawnCli("codex", args, prompt, {
      timeout: this.config.cli?.timeouts?.codex,
    });
    return this._normalizeOutput(raw, "codex");
  }

  /**
   * 코드 생성 특화 호출
   */
  async generateCode(modelKey, systemPrompt, codeRequest, options = {}) {
    const codePrompt = `${codeRequest}\n\n응답은 반드시 코드만 포함해주세요. 설명이 필요하면 코드 주석으로 작성해주세요.\n마크다운 코드블록(\`\`\`)으로 감싸주세요.`;
    return this.chat(modelKey, systemPrompt, codePrompt, options);
  }

  /**
   * 코드 리뷰 특화 호출
   */
  async reviewCode(modelKey, systemPrompt, code, criteria, options = {}) {
    const reviewPrompt = `다음 코드를 리뷰해주세요.\n\n## 코드\n\`\`\`\n${code}\n\`\`\`\n\n## 수용 기준\n${criteria}\n\n## 리뷰 형식\n- 전체 평가: Approved / Changes Requested\n- 좋은 점\n- 개선 필요 사항 (구체적 라인/로직 지적)\n- 보안 이슈\n- 성능 이슈`;
    return this.chat(modelKey, systemPrompt, reviewPrompt, options);
  }

  /**
   * CLI 명령어 존재 여부 확인
   */
  _isCliAvailable(command) {
    try {
      const cmd = os.platform() === "win32" ? "where" : "which";
      execFileSync(cmd, [command], { stdio: "pipe", shell: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 사용 가능한 모델 목록 반환 (CLI 설치 여부 기반)
   */
  getAvailableModels() {
    if (this._availableCache) return this._availableCache;

    const available = [];
    for (const [key, modelConfig] of Object.entries(this.config.models)) {
      if (this._isCliAvailable(modelConfig.cli)) {
        available.push(key);
      }
    }
    this._availableCache = available;
    return available;
  }

  /**
   * CLI 설치 정보 반환 (경고 메시지용)
   */
  getCliStatus() {
    const installCommands = {
      claude: "npm install -g @anthropic-ai/claude-code",
      gemini: "npm install -g @google/gemini-cli",
      codex: "npm install -g @openai/codex",
    };

    const status = {};
    for (const [key, modelConfig] of Object.entries(this.config.models)) {
      const cli = modelConfig.cli;
      status[key] = {
        cli,
        installed: this._isCliAvailable(cli),
        installCommand: installCommands[cli] || `${cli} 설치 필요`,
      };
    }
    return status;
  }
}
