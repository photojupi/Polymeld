// src/agents/agent.js
// 개별 에이전트 (페르소나) 클래스
// 각 에이전트는 특정 AI 모델에 의해 구동됩니다
// contextBundle 패턴: 모든 메서드가 PromptAssembler가 조립한 구조화된 맥락을 받음

import { t } from "../i18n/index.js";

export class Agent {
  constructor(personaConfig, modelAdapter) {
    this.id = personaConfig.id; // e.g., "tech_lead"
    this.name = personaConfig.name; // e.g., "김아키"
    this.role = personaConfig.role; // e.g., "Tech Lead"
    this.modelKey = personaConfig.model; // e.g., "claude"
    this.imageModelKey = personaConfig.image_model || null; // e.g., "gemini_image"
    this.thinkingBudget = personaConfig.thinking_budget; // 0-100 or undefined
    this.description = personaConfig.description;
    this.expertise = personaConfig.expertise || [];
    this.style = personaConfig.style || "";
    this.adapter = modelAdapter;
  }

  /**
   * 시스템 프롬프트 생성 - 페르소나 성격/전문성을 주입
   */
  _buildSystemPrompt(context = "") {
    const expertiseStr = this.expertise.map((e) => `- ${e}`).join("\n");
    const contextSection = context ? `${t("agent.additionalContext")}\n${context}` : "";

    return t("agent.systemPrompt", {
      role: this.role,
      name: this.name,
      description: this.description,
      expertise: expertiseStr,
      style: this.style,
      context: contextSection,
    });
  }

  /**
   * 회의에서 발언
   * @param {string} topic - 회의 주제
   * @param {Object} contextBundle - ContextBuilder.buildForMeeting()의 반환값
   * @param {string} contextBundle.context - 조립된 맥락
   */
  async speak(topic, contextBundle, { modelOverride, onData } = {}) {
    const modelKey = modelOverride || this.modelKey;
    // contextBundle이 문자열인 경우 하위 호환 처리 (직접 context 문자열 전달)
    const context = typeof contextBundle === "string"
      ? contextBundle
      : (contextBundle?.context || "");

    const systemPrompt = this._buildSystemPrompt(context);

    let userMessage = `${t("agent.currentTopic")}\n${topic}`;
    userMessage += `\n\n${t("agent.speakInstruction", { name: this.name, role: this.role })}`;

    if (contextBundle?.allowPass) {
      userMessage += `\n\n${t("agent.passConditions")}`;
    }

    const response = await this.adapter.chat(
      modelKey,
      systemPrompt,
      userMessage,
      { thinkingBudget: this.thinkingBudget, onData }
    );

    return {
      agent: this.name,
      role: this.role,
      model: modelKey,
      content: response,
    };
  }

  /**
   * 코드 작성
   * @param {Object} contextBundle - ContextBuilder.buildForCoding() 또는 buildForFix()의 반환값
   * @param {string} contextBundle.systemContext - 시스템 맥락
   * @param {string} contextBundle.taskDescription - 태스크 설명
   * @param {string} contextBundle.acceptanceCriteria - 수용 기준
   * @param {string} [contextBundle.currentCode] - 현재 코드 (수정 시)
   */
  async writeCode(contextBundle, { modelOverride } = {}) {
    const modelKey = modelOverride || this.modelKey;
    const systemPrompt = this._buildSystemPrompt(contextBundle.systemContext);

    let prompt = `${t("agent.devTask")}\n${contextBundle.taskDescription}\n\n${t("agent.acceptanceCriteria")}\n${contextBundle.acceptanceCriteria}`;

    // 수정 모드: 현재 코드가 있으면 포함
    if (contextBundle.currentCode) {
      prompt += `\n\n${t("agent.currentCode")}\n${contextBundle.currentCode}`;
      prompt += `\n\n${t("agent.fixCode", { name: this.name, role: this.role })}`;
    } else {
      prompt += `\n\n${t("agent.writeCodeNew", { name: this.name, role: this.role })}`;
    }

    const response = await this.adapter.generateCode(
      modelKey,
      systemPrompt,
      prompt,
      { thinkingBudget: this.thinkingBudget }
    );

    return {
      agent: this.name,
      role: this.role,
      model: modelKey,
      code: response,
    };
  }

  /**
   * 코드 리뷰
   * @param {Object} contextBundle - ContextBuilder.buildForReview()의 반환값
   * @param {string} contextBundle.systemContext - 시스템 맥락
   * @param {string} contextBundle.code - 리뷰 대상 코드
   * @param {string} contextBundle.criteria - 수용 기준
   * @param {string} authorAgent - 코드 작성자 이름
   */
  async reviewCode(contextBundle, authorAgent, { modelOverride } = {}) {
    const modelKey = modelOverride || this.modelKey;
    const systemPrompt = this._buildSystemPrompt(
      `${t("agent.reviewContext", { author: authorAgent })}\n\n${contextBundle.systemContext}`
    );

    const response = await this.adapter.reviewCode(
      modelKey,
      systemPrompt,
      contextBundle.code,
      contextBundle.criteria,
      { thinkingBudget: this.thinkingBudget }
    );

    return {
      agent: this.name,
      role: this.role,
      model: modelKey,
      review: response,
    };
  }

  /**
   * QA 테스트
   * @param {Object} contextBundle - ContextBuilder.buildForQA()의 반환값
   * @param {string} contextBundle.systemContext - 시스템 맥락
   * @param {string} contextBundle.code - 검증 대상 코드
   * @param {string} contextBundle.criteria - 수용 기준
   * @param {string} contextBundle.taskDescription - 태스크 설명
   */
  async runQA(contextBundle, { modelOverride } = {}) {
    const modelKey = modelOverride || this.modelKey;
    const systemPrompt = this._buildSystemPrompt(
      `${t("agent.qaContext")}\n\n${contextBundle.systemContext}`
    );

    const prompt = `${t("agent.qaCodeSection")}
\`\`\`
${contextBundle.code}
\`\`\`

${t("agent.qaTaskSection")}
${contextBundle.taskDescription}

${t("agent.qaCriteriaSection")}
${contextBundle.criteria}

${t("agent.qaInstruction")}`;

    const response = await this.adapter.chat(
      modelKey,
      systemPrompt,
      prompt,
      { thinkingBudget: this.thinkingBudget }
    );

    return {
      agent: this.name,
      role: this.role,
      model: modelKey,
      qaResult: response,
    };
  }

  /**
   * 태스크 분해 (팀장 전용)
   * @param {Object} contextBundle - PromptAssembler가 조립한 맥락
   * @param {string} contextBundle.designDecisions - 설계 결정사항
   * @param {string} contextBundle.requirement - 프로젝트 요구사항
   */
  async breakdownTasks(contextBundle, { modelOverride } = {}) {
    const modelKey = modelOverride || this.modelKey;
    const systemPrompt = this._buildSystemPrompt(t("agent.taskBreakdownContext"));

    const prompt = t("agent.taskBreakdownPrompt", {
      requirement: contextBundle.requirement,
      designDecisions: contextBundle.designDecisions,
      roles: contextBundle.availableRoles || "ace_programmer, creative_programmer, devops, qa",
    });

    const response = await this.adapter.chat(
      modelKey,
      systemPrompt,
      prompt,
      { thinkingBudget: this.thinkingBudget }
    );

    return {
      agent: this.name,
      role: this.role,
      model: modelKey,
      tasks: response,
    };
  }

  /**
   * 이미지 생성이 가능한 에이전트인지 확인
   */
  get canGenerateImages() {
    return this.imageModelKey !== null;
  }

  /**
   * 이미지 생성
   * @param {Object} contextBundle - ContextBuilder.buildForImageGeneration()의 반환값
   * @param {string} contextBundle.systemContext - 시스템 맥락
   * @param {string} contextBundle.imagePrompt - 이미지 생성 프롬프트
   * @param {string} contextBundle.outputDir - 이미지 저장 디렉토리
   */
  async generateImage(contextBundle) {
    if (!this.imageModelKey) {
      throw new Error(t("agent.imageNotConfigured", { name: this.name, role: this.role }));
    }

    const systemPrompt = this._buildSystemPrompt(contextBundle.systemContext);

    const promptText = t("agent.imagePrompt", {
      prompt: contextBundle.imagePrompt,
      name: this.name,
      role: this.role,
    });

    const result = await this.adapter.generateImage(
      this.imageModelKey,
      systemPrompt,
      promptText,
      { outputDir: contextBundle.outputDir || "./output/images" }
    );

    return {
      agent: this.name,
      role: this.role,
      model: this.imageModelKey,
      images: result.images,
      textResponse: result.text,
    };
  }
}
