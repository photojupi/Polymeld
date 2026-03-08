// src/models/adapter.js
// CLI + API 기반 멀티 AI 모델 통합 어댑터
// 우선순위: CLI → API → fallback 모델
// CLI 사용량 초과 시 자동으로 API key로 전환

import crossSpawn from "cross-spawn";
import fs from "fs";
import path from "path";
import { t } from "../i18n/index.js";
import { isCliInstalled } from "../config/loader.js";

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
    this.category = CliError._categorize(cli, exitCode, stderr);
  }

  /**
   * CLI 이름과 종료 코드, stderr 내용을 기반으로 에러 카테고리를 분류한다.
   */
  static _categorize(cli, code, stderr = "") {
    // Rate limit 감지 (모든 CLI 공통, exit code보다 우선)
    if (CliError._isRateLimit(stderr)) return "rate_limit";
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
   * stderr 내용에서 rate limit / 사용량 한도 초과를 감지한다.
   * - Codex: "You've hit your usage limit", "Rate limit reached"
   * - Claude: "Rate limit reached", "overloaded_error", "rate_limit_error"
   * - Gemini: "Resource exhausted", "RESOURCE_EXHAUSTED", "rateLimitExceeded"
   */
  static _isRateLimit(stderr) {
    if (!stderr) return false;
    return /usage.?limit|rate.?limit|too many requests|resource.?exhausted|quota.?exceeded|overloaded_error|rateLimitExceeded/i.test(stderr)
      || /\b429\b/.test(stderr);
  }

  /**
   * 사용자에게 표시할 에러 메시지를 생성한다.
   */
  static _buildMessage(cli, code, stderr, stdout) {
    const output = (stderr || stdout || t("adapter.noOutput")).substring(0, 1500);
    return t("adapter.cliError", { cli, code, output });
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
    this._apiClients = {};
    this.cwd = null;
  }

  // ─── API key 확인 ──────────────────────────────────────

  /**
   * 해당 CLI 프로바이더에 대응하는 API key가 설정되어 있는지 확인
   */
  _hasApiKey(cli) {
    switch (cli) {
      case "claude": return !!process.env.ANTHROPIC_API_KEY;
      case "gemini": return !!process.env.GOOGLE_API_KEY;
      case "codex": return !!process.env.OPENAI_API_KEY;
      default: return false;
    }
  }

  // ─── API 클라이언트 지연 로딩 ──────────────────────────

  /**
   * SDK를 동적 import하여 API 클라이언트를 생성한다.
   * 최초 1회만 생성하고 캐시한다.
   */
  async _getApiClient(provider) {
    if (this._apiClients[provider]) return this._apiClients[provider];

    try {
      switch (provider) {
        case "claude": {
          const { default: Anthropic } = await import("@anthropic-ai/sdk");
          this._apiClients[provider] = new Anthropic();
          break;
        }
        case "gemini": {
          const { GoogleGenAI } = await import("@google/genai");
          this._apiClients[provider] = new GoogleGenAI({
            apiKey: process.env.GOOGLE_API_KEY,
          });
          break;
        }
        case "codex": {
          const { default: OpenAI } = await import("openai");
          this._apiClients[provider] = new OpenAI();
          break;
        }
        default:
          throw new Error(t("adapter.unsupportedCli", { cli: provider }));
      }
    } catch (err) {
      if (err.code === "ERR_MODULE_NOT_FOUND") {
        const sdkNames = { claude: "@anthropic-ai/sdk", gemini: "@google/genai", codex: "openai" };
        throw new Error(t("adapter.sdkNotInstalled", { sdk: sdkNames[provider] || provider }));
      }
      throw err;
    }

    return this._apiClients[provider];
  }

  // ─── API rate limit 감지 ──────────────────────────────

  /**
   * API SDK 에러에서 rate limit 여부를 판별한다.
   */
  _isApiRateLimit(error) {
    if (error?.status === 429) return true;
    if (error?.error?.type === "rate_limit_error") return true;
    if (error?.code === "rate_limit_exceeded") return true;
    const msg = error?.message || "";
    if (/resource.?exhausted|rate.?limit|quota.?exceeded|too many requests/i.test(msg)) return true;
    return false;
  }

  // ─── CLI 서브프로세스 실행 ─────────────────────────────

  /**
   * CLI 서브프로세스 실행 (stdin 방식)
   * options.timeout: 숫자(ms, 기존 wall-clock) 또는 { idle, max } 객체
   *   - 숫자: max만 작동 (하위호환)
   *   - { idle, max }: idle=무응답 감지(출력 시 리셋), max=절대 상한
   *   - 0이면 해당 타이머 비활성
   */
  _spawnCli(command, args, stdinData, options = {}) {
    const rawTimeout = options.timeout ?? this.config.cli?.timeout ?? 300000;

    // 정규화: 숫자 → max only (하위호환), 객체 → idle + max
    const tc = typeof rawTimeout === "number"
      ? { idle: 0, max: rawTimeout }
      : { idle: rawTimeout.idle || 0, max: rawTimeout.max || 0 };

    return new Promise((resolve, reject) => {
      const proc = crossSpawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
        ...(this.cwd && { cwd: this.cwd }),
      });

      let stdout = "";
      let stderr = "";
      let killed = false;
      let maxTimer = null;
      let idleTimer = null;

      // kill 헬퍼 — idle/max 양쪽에서 호출, killed 플래그로 중복 방지
      const killProc = (reason) => {
        if (killed) return;
        killed = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 5000);
        if (maxTimer) clearTimeout(maxTimer);
        if (idleTimer) clearTimeout(idleTimer);
        reject(new CliError(command, -1, reason, stdout.substring(0, 200)));
      };

      // max 타이머 (절대 상한, 리셋 없음)
      if (tc.max > 0) {
        maxTimer = setTimeout(() => {
          killProc(t("adapter.timeoutMax", { seconds: tc.max / 1000 }));
        }, tc.max);
      }

      // idle 타이머 (출력 시 리셋)
      const resetIdleTimer = () => {
        if (tc.idle <= 0) return;
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          killProc(t("adapter.timeoutIdle", { seconds: tc.idle / 1000 }));
        }, tc.idle);
      };
      resetIdleTimer();

      proc.stdout.on("data", (d) => {
        const chunk = d.toString();
        stdout += chunk;
        if (options.onData) options.onData(chunk);
        resetIdleTimer();
      });
      proc.stderr.on("data", (d) => {
        stderr += d.toString();
        resetIdleTimer();
      });
      proc.on("error", (err) => {
        if (maxTimer) clearTimeout(maxTimer);
        if (idleTimer) clearTimeout(idleTimer);
        reject(new Error(t("adapter.cliExecFailed", { command, message: err.message })));
      });
      proc.on("close", (code) => {
        if (maxTimer) clearTimeout(maxTimer);
        if (idleTimer) clearTimeout(idleTimer);
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
    return `${t("adapter.systemInstructions")}\n${systemPrompt}\n\n---\n\n${t("adapter.request")}\n${userMessage}`;
  }

  /**
   * thinking_budget (0-100) → CLI별 인자 배열로 변환
   */
  _resolveThinkingArgs(cli, budget) {
    if (budget == null) return [];

    switch (cli) {
      case "claude": {
        // Claude: --effort (low/medium/high)
        let effort = "medium";
        if (budget <= 33) effort = "low";
        else if (budget <= 75) effort = "medium";
        else effort = "high";
        return ["--effort", effort];
      }
      case "gemini":
        // Gemini CLI: thinking 제어 플래그 미지원 (모델 자체 설정에 의존)
        return [];
      case "codex": {
        // Codex: -c model_reasoning_effort (low/medium/high/xhigh)
        let effort = "medium";
        if (budget <= 25) effort = "low";
        else if (budget <= 60) effort = "medium";
        else if (budget <= 85) effort = "high";
        else effort = "xhigh";
        return ["-c", `model_reasoning_effort="${effort}"`];
      }
      default:
        return [];
    }
  }

  // ─── 통합 chat 메서드 (CLI → API → fallback) ─────────

  /**
   * 지정된 모델로 메시지를 보내고 응답을 받음
   *
   * 우선순위:
   * 1. CLI (설치되어 있으면)
   * 2. API key (CLI rate limit 시 또는 CLI 미설치 시)
   * 3. fallback 모델 (1, 2 모두 rate limit 시)
   */
  async chat(modelKey, systemPrompt, userMessage, options = {}) {
    const modelConfig = this.config.models?.[modelKey];
    if (!modelConfig) {
      throw new Error(t("adapter.modelNotFound", { key: modelKey }));
    }

    const thinkingBudget = options.thinkingBudget;
    const onData = options.onData;

    const hasCli = isCliInstalled(modelConfig.cli);
    const hasApiKey = this._hasApiKey(modelConfig.cli);

    if (!hasCli && !hasApiKey) {
      throw new Error(t("adapter.noBackend", { key: modelKey, cli: modelConfig.cli }));
    }

    let lastError;

    // 1. CLI 시도 (설치되어 있으면)
    if (hasCli) {
      try {
        switch (modelConfig.cli) {
          case "claude":
            return await this._chatClaude(modelConfig.model, systemPrompt, userMessage, thinkingBudget, onData);
          case "gemini":
            return await this._chatGemini(modelConfig.model, systemPrompt, userMessage, thinkingBudget, onData);
          case "codex":
            return await this._chatCodex(modelConfig.model, systemPrompt, userMessage, thinkingBudget, onData);
          default:
            throw new Error(t("adapter.unsupportedCli", { cli: modelConfig.cli }));
        }
      } catch (error) {
        if (error instanceof CliError && error.category === "rate_limit") {
          lastError = error;
          if (hasApiKey) {
            console.log(t("adapter.cliRateLimitApiSwitch", { key: modelKey }));
          }
          // API 시도로 넘어감
        } else {
          throw error;
        }
      }
    }

    // 2. API 시도 (API key가 있으면)
    if (hasApiKey) {
      try {
        const apiModel = modelConfig.api_model || modelConfig.model;
        return await this._chatViaApi(modelConfig.cli, apiModel, systemPrompt, userMessage, thinkingBudget);
      } catch (error) {
        if (this._isApiRateLimit(error)) {
          lastError = error;
          // fallback 모델로 넘어감
        } else {
          throw error;
        }
      }
    }

    // 3. fallback 모델 시도 (rate limit이었을 때만)
    if (lastError && modelConfig.fallback && !options._isFallback) {
      const fbKey = modelConfig.fallback;
      if (this.config.models?.[fbKey]) {
        console.log(t("adapter.rateLimitFallback", { from: modelKey, to: fbKey }));
        return this.chat(fbKey, systemPrompt, userMessage, { ...options, _isFallback: true });
      }
      console.warn(t("adapter.rateLimitNoFallback", { from: modelKey, fallback: fbKey }));
    }

    throw lastError || new Error(t("adapter.noBackend", { key: modelKey, cli: modelConfig.cli }));
  }

  // ─── API 기반 chat 디스패처 ───────────────────────────

  /**
   * CLI 프로바이더 이름에 따라 적절한 API chat 메서드를 호출
   */
  async _chatViaApi(cli, model, systemPrompt, userMessage, thinkingBudget) {
    switch (cli) {
      case "claude":
        return await this._chatClaudeApi(model, systemPrompt, userMessage, thinkingBudget);
      case "gemini":
        return await this._chatGeminiApi(model, systemPrompt, userMessage, thinkingBudget);
      case "codex":
        return await this._chatOpenAiApi(model, systemPrompt, userMessage, thinkingBudget);
      default:
        throw new Error(t("adapter.unsupportedCli", { cli }));
    }
  }

  // ─── CLI 기반 chat 메서드 ─────────────────────────────

  /**
   * Claude Code: --system-prompt 플래그 지원, stdin으로 메시지 전달
   * --max-turns로 무한 에이전트 루프 방지
   */
  async _chatClaude(model, systemPrompt, userMessage, thinkingBudget, onData) {
    const args = ["-p", "--output-format", "text"];
    if (model) args.push("--model", model);
    if (systemPrompt) args.push("--system-prompt", systemPrompt);

    // max-turns 제한으로 무한 에이전트 루프 방지
    const maxTurns = this.config.cli?.max_turns?.claude ?? 3;
    args.push("--max-turns", String(maxTurns));

    args.push(...this._resolveThinkingArgs("claude", thinkingBudget));

    const raw = await this._spawnCli("claude", args, userMessage, {
      timeout: this.config.cli?.timeouts?.claude,
      onData,
    });
    return this._normalizeOutput(raw, "claude");
  }

  /**
   * Gemini CLI: stdin pipe로 프롬프트 전달 (안전한 방식)
   * 최신 Gemini CLI(v0.28+)는 stdin/pipe 입력을 정식 지원
   */
  async _chatGemini(model, systemPrompt, userMessage, thinkingBudget, onData) {
    const prompt = systemPrompt
      ? this._buildCombinedPrompt(systemPrompt, userMessage)
      : userMessage;

    // stdin pipe 방식: 셸 이스케이핑 불필요, 보안 안전
    const args = ["--output-format", "text"];
    if (model) args.push("-m", model);

    args.push(...this._resolveThinkingArgs("gemini", thinkingBudget));

    const raw = await this._spawnCli("gemini", args, prompt, {
      timeout: this.config.cli?.timeouts?.gemini,
      onData,
    });
    return this._normalizeOutput(raw, "gemini");
  }

  /**
   * Codex CLI: codex exec + stdin 파이핑
   * exec 자체가 비대화형 모드이므로 별도 quiet 플래그 불필요
   * --full-auto: 승인 프롬프트 없이 샌드박스 내 자동 실행
   * --skip-git-repo-check: 임의 디렉토리에서 실행 가능
   * --sandbox read-only: 파일 수정 방지
   */
  async _chatCodex(model, systemPrompt, userMessage, thinkingBudget, onData) {
    const prompt = systemPrompt
      ? this._buildCombinedPrompt(systemPrompt, userMessage)
      : userMessage;

    const args = [
      "exec",
      "--sandbox", "read-only",
      "--skip-git-repo-check",
      "--full-auto",
    ];
    if (model) args.push("-m", model);

    args.push(...this._resolveThinkingArgs("codex", thinkingBudget));

    const raw = await this._spawnCli("codex", args, prompt, {
      timeout: this.config.cli?.timeouts?.codex,
      onData,
    });
    return this._normalizeOutput(raw, "codex");
  }

  // ─── API 기반 chat 메서드 ─────────────────────────────

  /**
   * Claude API: Anthropic SDK를 통한 메시지 전송
   * thinking_budget 매핑:
   *   0-33 → extended thinking 비활성
   *   34-75 → budget_tokens 4096
   *   76-100 → budget_tokens 16384
   */
  async _chatClaudeApi(model, systemPrompt, userMessage, thinkingBudget) {
    const client = await this._getApiClient("claude");

    const params = {
      model,
      max_tokens: 8192,
      messages: [{ role: "user", content: userMessage }],
    };
    if (systemPrompt) params.system = systemPrompt;

    // Extended thinking 매핑
    if (thinkingBudget != null && thinkingBudget > 33) {
      const budgetTokens = thinkingBudget > 75 ? 16384 : 4096;
      params.thinking = { type: "enabled", budget_tokens: budgetTokens };
      // thinking + output이 모델 상한(보통 32768)을 넘지 않도록 제한
      params.max_tokens = Math.min(budgetTokens + 8192, 32000);
    }

    const response = await client.messages.create(params);
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text) throw new Error(t("adapter.noOutput"));
    return text;
  }

  /**
   * Gemini API: Google GenAI SDK를 통한 메시지 전송
   * thinking_budget 매핑:
   *   0-33 → budget_tokens 1024
   *   34-75 → budget_tokens 8192
   *   76-100 → budget_tokens 24576
   */
  async _chatGeminiApi(model, systemPrompt, userMessage, thinkingBudget) {
    const client = await this._getApiClient("gemini");

    const config = {};
    if (systemPrompt) config.systemInstruction = systemPrompt;

    // Thinking budget 매핑
    if (thinkingBudget != null && thinkingBudget > 0) {
      let budgetTokens = 1024;
      if (thinkingBudget > 33) budgetTokens = 8192;
      if (thinkingBudget > 75) budgetTokens = 24576;
      config.thinkingConfig = { thinkingBudget: budgetTokens };
    }

    const response = await client.models.generateContent({
      model,
      contents: userMessage,
      config,
    });

    const text = response.text;
    if (text == null) throw new Error(t("adapter.noOutput"));
    return text;
  }

  /**
   * OpenAI API: OpenAI SDK를 통한 메시지 전송
   * thinking_budget 매핑:
   *   0-25 → reasoning_effort "low"
   *   26-60 → reasoning_effort "medium"
   *   61-85 → reasoning_effort "high"
   *   86-100 → (high, OpenAI API에는 xhigh 없음)
   */
  async _chatOpenAiApi(model, systemPrompt, userMessage, thinkingBudget) {
    const client = await this._getApiClient("codex");

    const messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: userMessage });

    const params = { model, messages };

    // Reasoning effort 매핑
    if (thinkingBudget != null) {
      let effort = "medium";
      if (thinkingBudget <= 25) effort = "low";
      else if (thinkingBudget <= 60) effort = "medium";
      else effort = "high";
      params.reasoning_effort = effort;
    }

    const response = await client.chat.completions.create(params);
    const content = response.choices?.[0]?.message?.content;
    if (content == null) throw new Error(t("adapter.noOutput"));
    return content;
  }

  // ─── 특화 호출 메서드 (기존 유지) ─────────────────────

  /**
   * 코드 생성 특화 호출
   */
  async generateCode(modelKey, systemPrompt, codeRequest, options = {}) {
    const codePrompt = `${codeRequest}\n\n${t("adapter.codeOnlyInstruction")}`;
    return this.chat(modelKey, systemPrompt, codePrompt, { ...options });
  }

  /**
   * 코드 리뷰 특화 호출
   */
  async reviewCode(modelKey, systemPrompt, code, criteria, options = {}) {
    const reviewPrompt = t("adapter.reviewInstruction", { code, criteria });
    return this.chat(modelKey, systemPrompt, reviewPrompt, { ...options });
  }

  /**
   * 이미지 생성 특화 호출
   * Gemini image model의 JSON 응답에서 base64 이미지를 추출하여 파일로 저장
   */
  async generateImage(modelKey, systemPrompt, imageRequest, options = {}) {
    const modelConfig = this.config.models?.[modelKey];
    if (!modelConfig) {
      throw new Error(t("adapter.modelNotFound", { key: modelKey }));
    }
    if (modelConfig.cli !== "gemini") {
      throw new Error(t("adapter.imageOnlyGemini", { cli: modelConfig.cli }));
    }

    const outputDir = options.outputDir || "./output/images";
    return this._generateImageGemini(modelConfig.model, systemPrompt, imageRequest, outputDir);
  }

  /**
   * Gemini CLI로 이미지 생성 호출 (JSON 모드)
   */
  async _generateImageGemini(model, systemPrompt, userMessage, outputDir) {
    const prompt = systemPrompt
      ? this._buildCombinedPrompt(systemPrompt, userMessage)
      : userMessage;

    const args = ["--output-format", "json"];
    if (model) args.push("-m", model);

    const raw = await this._spawnCli("gemini", args, prompt, {
      timeout: this.config.cli?.timeouts?.gemini_image || 600000,
    });

    return this._parseImageResponse(raw, outputDir);
  }

  /**
   * Gemini CLI JSON 응답에서 이미지 데이터와 텍스트를 추출
   */
  _parseImageResponse(rawJson, outputDir) {
    const images = [];
    let text = "";

    try {
      const response = JSON.parse(rawJson);
      const parts = response?.candidates?.[0]?.content?.parts
        || response?.parts
        || [];

      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      let imageIndex = 0;
      for (const part of parts) {
        if (part.text) {
          text += part.text;
        } else if (part.inlineData) {
          imageIndex++;
          const mimeType = part.inlineData.mimeType || "image/png";
          const ext = mimeType.includes("jpeg") ? "jpg" : "png";
          const filename = `generated_${Date.now()}_${imageIndex}.${ext}`;
          const filePath = path.join(outputDir, filename);

          const buffer = Buffer.from(part.inlineData.data, "base64");
          fs.writeFileSync(filePath, buffer);

          images.push({ path: filePath, mimeType });
        }
      }
    } catch {
      text = this._normalizeOutput(rawJson, "gemini");
    }

    return { images, text };
  }

  // ─── 모델 상태 조회 ───────────────────────────────────

  /**
   * 사용 가능한 모델 목록 반환 (CLI 설치 여부 + API key 기반)
   */
  getAvailableModels() {
    if (this._availableCache) return this._availableCache;

    const available = [];
    for (const [key, modelConfig] of Object.entries(this.config.models || {})) {
      if (isCliInstalled(modelConfig.cli) || this._hasApiKey(modelConfig.cli)) {
        available.push(key);
      }
    }
    this._availableCache = available;
    return available;
  }

  /**
   * CLI 설치 및 API key 상태 정보 반환
   */
  getCliStatus() {
    const installCommands = {
      claude: "npm install -g @anthropic-ai/claude-code",
      gemini: "npm install -g @google/gemini-cli",
      codex: "npm install -g @openai/codex",
    };

    const status = {};
    for (const [key, modelConfig] of Object.entries(this.config.models || {})) {
      const cli = modelConfig.cli;
      status[key] = {
        cli,
        installed: isCliInstalled(cli),
        hasApiKey: this._hasApiKey(cli),
        installCommand: installCommands[cli] || t("adapter.installRequired", { cli }),
      };
    }
    return status;
  }
}
