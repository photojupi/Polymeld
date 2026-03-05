// src/models/adapter.js
// CLI 기반 멀티 AI 모델 통합 어댑터
// Claude Code, Gemini CLI, Codex CLI를 서브프로세스로 호출

import { spawn, execFileSync } from "child_process";
import os from "os";

export class ModelAdapter {
  constructor(config) {
    this.config = config;
    this._availableCache = null;
  }

  /**
   * CLI 서브프로세스 실행 (stdin 방식)
   * shell: true로 Windows .cmd/.ps1 호환
   */
  _spawnCli(command, args, stdinData) {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
        env: { ...process.env },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (d) => (stdout += d.toString()));
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("error", (err) =>
        reject(new Error(`CLI 실행 실패 (${command}): ${err.message}`))
      );
      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`CLI 오류 (${command}, exit ${code}): ${stderr || stdout}`));
        } else {
          resolve(stdout.trim());
        }
      });

      if (stdinData) proc.stdin.write(stdinData);
      proc.stdin.end();
    });
  }

  /**
   * CLI 서브프로세스 실행 (전체 명령어 문자열 방식)
   * Gemini CLI처럼 stdin을 지원하지 않고 인수로 프롬프트를 받는 경우 사용.
   * 명령어 전체를 하나의 문자열로 구성하여 쉘이 따옴표를 올바르게 처리하도록 함.
   */
  _spawnShellCmd(cmdString) {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmdString, [], {
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
        env: { ...process.env },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (d) => (stdout += d.toString()));
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("error", (err) =>
        reject(new Error(`CLI 실행 실패: ${err.message}`))
      );
      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`CLI 오류 (exit ${code}): ${stderr || stdout}`));
        } else {
          resolve(stdout.trim());
        }
      });

      proc.stdin.end();
    });
  }

  /**
   * 시스템 프롬프트 + 사용자 메시지를 합친 프롬프트 생성
   * (Gemini CLI, Codex CLI용 — system prompt 플래그 미지원)
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
   */
  async _chatClaude(model, systemPrompt, userMessage) {
    const args = ["-p", "--output-format", "text"];
    if (model) args.push("--model", model);
    if (systemPrompt) args.push("--system-prompt", systemPrompt);
    return this._spawnCli("claude", args, userMessage);
  }

  /**
   * Gemini CLI: -p 플래그에 프롬프트를 인수로 직접 전달
   * stdin 미지원 → 전체 명령어를 하나의 문자열로 구성하여 따옴표 처리
   */
  async _chatGemini(model, systemPrompt, userMessage) {
    const prompt = systemPrompt
      ? this._buildCombinedPrompt(systemPrompt, userMessage)
      : userMessage;
    // 프롬프트 내 따옴표를 이스케이프
    const escaped = prompt.replace(/"/g, '\\"');
    let cmd = `gemini -p "${escaped}"`;
    if (model) cmd += ` -m ${model}`;
    return this._spawnShellCmd(cmd);
  }

  /**
   * Codex CLI: codex exec + stdin 파이핑 ("-"으로 stdin 읽기)
   * --skip-git-repo-check: 임의 디렉토리에서 실행 가능
   * --sandbox read-only: 파일 수정 방지
   */
  async _chatCodex(model, systemPrompt, userMessage) {
    const prompt = systemPrompt
      ? this._buildCombinedPrompt(systemPrompt, userMessage)
      : userMessage;
    const args = ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "-"];
    return this._spawnCli("codex", args, prompt);
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
