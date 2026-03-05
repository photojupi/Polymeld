// src/agents/agent.js
// 개별 에이전트 (페르소나) 클래스
// 각 에이전트는 특정 AI 모델에 의해 구동됩니다

export class Agent {
  constructor(personaConfig, modelAdapter) {
    this.id = personaConfig.id; // e.g., "tech_lead"
    this.name = personaConfig.name; // e.g., "김아키"
    this.role = personaConfig.role; // e.g., "Tech Lead"
    this.modelKey = personaConfig.model; // e.g., "claude"
    this.description = personaConfig.description;
    this.expertise = personaConfig.expertise || [];
    this.style = personaConfig.style || "";
    this.adapter = modelAdapter;
    this.conversationHistory = [];
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
   */
  async speak(topic, context = "", previousDiscussion = "") {
    const systemPrompt = this._buildSystemPrompt(context);

    let userMessage = `## 현재 논의 주제\n${topic}`;
    if (previousDiscussion) {
      userMessage += `\n\n## 이전 논의 내용\n${previousDiscussion}`;
      userMessage += `\n\n위 논의를 참고하여 ${this.name} (${this.role})로서 의견을 제시해주세요. 동의/반대/보완 의견 모두 가능합니다.`;
    } else {
      userMessage += `\n\n${this.name} (${this.role})로서 이 주제에 대한 의견을 제시해주세요.`;
    }

    const response = await this.adapter.chat(
      this.modelKey,
      systemPrompt,
      userMessage
    );

    this.conversationHistory.push(
      { role: "user", content: userMessage },
      { role: "assistant", content: response }
    );

    return {
      agent: this.name,
      role: this.role,
      model: this.modelKey,
      content: response,
    };
  }

  /**
   * 코드 작성
   */
  async writeCode(taskDescription, techStack, acceptanceCriteria) {
    const systemPrompt = this._buildSystemPrompt(
      `현재 작업 중인 기술 스택: ${techStack}`
    );

    const prompt = `## 개발 태스크
${taskDescription}

## 수용 기준
${acceptanceCriteria}

위 태스크를 구현해주세요. ${this.name}(${this.role})의 코딩 스타일과 전문성을 반영하여 작성합니다.`;

    const response = await this.adapter.generateCode(
      this.modelKey,
      systemPrompt,
      prompt
    );

    return {
      agent: this.name,
      role: this.role,
      model: this.modelKey,
      code: response,
    };
  }

  /**
   * 코드 리뷰
   */
  async reviewCode(code, criteria, authorAgent) {
    const systemPrompt = this._buildSystemPrompt(
      `${authorAgent}가 작성한 코드를 리뷰합니다.`
    );

    const response = await this.adapter.reviewCode(
      this.modelKey,
      systemPrompt,
      code,
      criteria
    );

    return {
      agent: this.name,
      role: this.role,
      model: this.modelKey,
      review: response,
    };
  }

  /**
   * QA 테스트
   */
  async runQA(code, acceptanceCriteria, taskDescription) {
    const systemPrompt = this._buildSystemPrompt(
      "QA 엔지니어로서 코드의 품질과 수용 기준 충족 여부를 검증합니다."
    );

    const prompt = `## 검증 대상 코드
\`\`\`
${code}
\`\`\`

## 태스크 설명
${taskDescription}

## 수용 기준
${acceptanceCriteria}

위 코드에 대해 QA 검증을 수행해주세요.

응답 형식:
1. 수용 기준별 검증 결과 (표 형식)
2. 엣지 케이스 테스트 결과
3. 발견된 버그/이슈
4. 종합 판정: PASS / FAIL`;

    const response = await this.adapter.chat(
      this.modelKey,
      systemPrompt,
      prompt
    );

    return {
      agent: this.name,
      role: this.role,
      model: this.modelKey,
      qaResult: response,
    };
  }

  /**
   * 태스크 분해 (팀장 전용)
   */
  async breakdownTasks(designDecisions, requirement) {
    const systemPrompt = this._buildSystemPrompt(
      "프로젝트의 기술 설계가 완료되었습니다. 이를 실행 가능한 태스크로 분해합니다."
    );

    const prompt = `## 프로젝트 요구사항
${requirement}

## 기술 설계 결정사항
${designDecisions}

위 내용을 기반으로 태스크를 분해해주세요.

## 규칙
- 각 태스크는 1-4시간 분량
- 의존성을 명시 (어떤 태스크가 먼저 완료되어야 하는지)
- 각 태스크에 적합한 역할(backend_dev, frontend_dev, devops, qa) 명시
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
      this.modelKey,
      systemPrompt,
      prompt
    );

    return {
      agent: this.name,
      role: this.role,
      model: this.modelKey,
      tasks: response,
    };
  }

  /**
   * 대화 히스토리 초기화
   */
  resetHistory() {
    this.conversationHistory = [];
  }
}
