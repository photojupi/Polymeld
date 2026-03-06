// src/agents/agent.js
// 개별 에이전트 (페르소나) 클래스
// 각 에이전트는 특정 AI 모델에 의해 구동됩니다
// contextBundle 패턴: 모든 메서드가 PromptAssembler가 조립한 구조화된 맥락을 받음

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
    return `당신은 소프트웨어 개발팀의 ${this.role}인 "${this.name}"입니다.

## 성격 및 특징
${this.description}

## 전문 영역
${this.expertise.map((e) => `- ${e}`).join("\n")}

## 말투 및 스타일
${this.style}

## 행동 규칙
- 항상 "${this.name}" (${this.role})의 관점에서 발언합니다
- 자신의 전문 영역에서는 확신을 가지고 의견을 제시합니다
- 다른 영역에 대해서는 질문하거나 우려를 표합니다
- 의견을 제시할 때는 반드시 근거를 함께 제시합니다
- 반대 의견이 있을 때는 대안을 함께 제시합니다
- 한국어로 대화합니다

${context ? `## 추가 컨텍스트\n${context}` : ""}`;
  }

  /**
   * 회의에서 발언
   * @param {string} topic - 회의 주제
   * @param {Object} contextBundle - ContextBuilder.buildForMeeting()의 반환값
   * @param {string} contextBundle.context - 조립된 맥락
   * @param {string} [contextBundle.previousDiscussion] - 이전 논의 (호환성)
   */
  async speak(topic, contextBundle, { modelOverride, onData } = {}) {
    const modelKey = modelOverride || this.modelKey;
    // contextBundle이 문자열인 경우 하위 호환 처리 (직접 context 문자열 전달)
    const context = typeof contextBundle === "string"
      ? contextBundle
      : (contextBundle?.context || "");
    const previousDiscussion = typeof contextBundle === "object"
      ? contextBundle?.previousDiscussion
      : undefined;

    const systemPrompt = this._buildSystemPrompt(context);

    let userMessage = `## 현재 논의 주제\n${topic}`;
    if (previousDiscussion) {
      userMessage += `\n\n## 이전 논의\n${previousDiscussion}`;
      userMessage += `\n\n${this.name}(${this.role})로서 의견을 제시해주세요.`;
    } else {
      userMessage += `\n\n${this.name} (${this.role})로서 이 주제에 대한 의견을 제시해주세요.`;
    }

    if (contextBundle?.allowPass) {
      userMessage += `\n\n다음 중 하나라도 해당하면 [PASS]로만 응답하세요:
- 이 주제에서 본인이 직접 맡아 수행할 작업이 없는 경우
- 이전 논의에서 이미 충분히 다뤄져 새로 추가할 의견이 없는 경우
- 본인의 이전 발언과 실질적으로 같은 내용을 반복하게 되는 경우
억지로 내용을 만들지 마세요. 새로운 관점이나 구체적 제안이 있을 때만 발언하세요.`;
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

    let prompt = `## 개발 태스크\n${contextBundle.taskDescription}\n\n## 수용 기준\n${contextBundle.acceptanceCriteria}`;

    // 수정 모드: 현재 코드가 있으면 포함
    if (contextBundle.currentCode) {
      prompt += `\n\n## 현재 코드\n${contextBundle.currentCode}`;
      prompt += `\n\n위 코드를 수정하여 피드백을 반영해주세요. ${this.name}(${this.role})의 코딩 스타일과 전문성을 반영하여 수정된 전체 코드를 작성합니다.`;
    } else {
      prompt += `\n\n위 태스크를 구현해주세요. ${this.name}(${this.role})의 코딩 스타일과 전문성을 반영하여 작성합니다.`;
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
      `${authorAgent}가 작성한 코드를 리뷰합니다.\n\n${contextBundle.systemContext}`
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
      `QA 엔지니어로서 코드의 품질과 수용 기준 충족 여부를 검증합니다.\n\n${contextBundle.systemContext}`
    );

    const prompt = `## 검증 대상 코드
\`\`\`
${contextBundle.code}
\`\`\`

## 태스크 설명
${contextBundle.taskDescription}

## 수용 기준
${contextBundle.criteria}

위 코드에 대해 QA 검증을 수행해주세요.

응답 형식:
1. 수용 기준별 검증 결과 (표 형식)
2. 엣지 케이스 테스트 결과
3. 발견된 버그/이슈
4. 종합 판정: PASS / FAIL

마지막에 다음 JSON 블록을 반드시 추가해주세요:
\`\`\`json
{ "verdict": "PASS 또는 FAIL", "summary": "한줄 요약" }
\`\`\``;

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
    const systemPrompt = this._buildSystemPrompt(
      "프로젝트의 기술 설계가 완료되었습니다. 이를 실행 가능한 태스크로 분해합니다."
    );

    const prompt = `## 프로젝트 요구사항
${contextBundle.requirement}

## 기술 설계 결정사항
${contextBundle.designDecisions}

위 내용을 기반으로 태스크를 분해해주세요.

## 규칙
- 각 태스크는 1-4시간 분량
- 의존성을 명시 (어떤 태스크가 먼저 완료되어야 하는지)
- 각 태스크에 적합한 역할(${contextBundle.availableRoles || 'backend_dev, frontend_dev, devops, qa'}) 명시
- 수용 기준을 구체적으로 작성

## 응답 형식 (JSON)
\`\`\`json
{
  "tasks": [
    {
      "title": "태스크 제목",
      "description": "상세 설명",
      "suitable_role": "backend_dev",
      "estimated_hours": 2,
      "priority": "P0",
      "dependencies": [],
      "acceptance_criteria": ["기준1", "기준2"],
      "category": "backend"
    }
  ]
}
\`\`\``;

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
      throw new Error(`${this.name}(${this.role})은 image_model이 설정되지 않아 이미지 생성 불가`);
    }

    const systemPrompt = this._buildSystemPrompt(contextBundle.systemContext);

    const prompt = `## 이미지 생성 요청\n${contextBundle.imagePrompt}\n\n` +
      `위 설명에 맞는 이미지를 생성해주세요. ${this.name}(${this.role})의 디자인 감각과 전문성을 반영합니다.`;

    const result = await this.adapter.generateImage(
      this.imageModelKey,
      systemPrompt,
      prompt,
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
