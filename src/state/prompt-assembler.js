// src/state/prompt-assembler.js
// 토큰 예산 내 프롬프트 맥락 조립기
// PipelineState에서 작업별 필요한 맥락을 우선순위 기반으로 조립

export class PromptAssembler {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxChars=6000] - 기본 최대 문자 수 (~1500 토큰)
   */
  constructor(options = {}) {
    this.maxChars = options.maxChars || 6000;
  }

  /**
   * 회의 발언용 맥락 조립
   * @param {import('./pipeline-state.js').PipelineState} state
   * @param {Object} opts
   * @param {string} opts.agentId
   * @param {string} opts.topic
   * @param {number} [opts.maxPreviousSpeeches=8]
   * @param {number} [opts.maxChars]
   * @returns {{ context: string, topic: string }}
   */
  forMeeting(state, { agentId, topic, maxPreviousSpeeches = 8, maxChars } = {}) {
    const budget = maxChars || this.maxChars;
    const sections = [];
    let used = 0;

    // 1. 필수: 프로젝트 정보
    const projectInfo = this._buildProjectSection(state);
    sections.push(projectInfo);
    used += projectInfo.length;

    // 2. 최근 회의 발언 (자기 발언 제외)
    const speeches = state.messages
      .filter((m) => m.type === "meeting_speech" && m.from !== agentId)
      .slice(-maxPreviousSpeeches);

    if (speeches.length > 0) {
      const speechSection = this._buildSpeechSection(speeches, budget - used);
      if (speechSection) {
        sections.push(speechSection);
        used += speechSection.length;
      }
    }

    // 3. 코드베이스 분석 (수정 모드에서 Phase 0 결과)
    if (state.codebaseAnalysis && budget - used > 200) {
      const maxCodebase = Math.floor((budget - used) * 0.4);
      const truncated = this._truncate(state.codebaseAnalysis, maxCodebase);
      if (truncated) {
        const section = `## 기존 코드베이스 분석\n${truncated}`;
        sections.push(section);
        used += section.length;
      }
    }

    // 4. 설계 결정 요약
    if (used < budget - 500 && state.designDecisions) {
      const summary = this._truncate(state.designDecisions, budget - used - 100);
      if (summary) {
        const section = `## 설계 결정 참고\n${summary}`;
        sections.push(section);
        used += section.length;
      }
    }

    return {
      context: sections.join("\n\n"),
      topic,
    };
  }

  /**
   * 코드 작성용 맥락 조립
   * @param {import('./pipeline-state.js').PipelineState} state
   * @param {Object} opts
   * @param {string} opts.agentId
   * @param {string} opts.taskId
   * @param {string} [opts.codebaseContext] - 기존 코드베이스 맥락 (워크스페이스에서 조립)
   * @param {number} [opts.maxChars]
   * @returns {{ systemContext: string, taskDescription: string, acceptanceCriteria: string }}
   */
  forCoding(state, { agentId, taskId, codebaseContext, maxChars } = {}) {
    const budget = maxChars || this.maxChars;
    const sections = [];
    let used = 0;

    // 1. 프로젝트 정보
    const projectInfo = this._buildProjectSection(state);
    sections.push(projectInfo);
    used += projectInfo.length;

    // 2. 태스크 정보
    const task = state.findTask(taskId);
    const taskDesc = task?.description || "";
    const criteria = task?.acceptance_criteria?.join("\n") || "";

    // 3. 기존 코드베이스 맥락 (높은 우선순위)
    if (codebaseContext && budget - used > 100) {
      const maxCodebase = Math.min(codebaseContext.length, Math.floor((budget - used) * 0.4));
      if (maxCodebase > 50) {
        const truncated = this._truncate(codebaseContext, maxCodebase);
        if (truncated) {
          const section = `## 기존 코드베이스 참고\n${truncated}`;
          sections.push(section);
          used += section.length;
        }
      }
    }

    // 4. 기술 스택
    if (state.techStack) {
      const valueStr = typeof state.techStack === "string"
        ? state.techStack : JSON.stringify(state.techStack, null, 2);
      const techSection = `## 기술 스택\n${valueStr}`;
      if (used + techSection.length < budget) {
        sections.push(techSection);
        used += techSection.length;
      }
    }

    // 5. 설계 결정 (코드베이스 맥락이 있으면 예산 축소)
    if (state.designDecisions) {
      const designBudget = codebaseContext ? 1000 : 2000;
      const summary = this._truncate(state.designDecisions, Math.min(designBudget, budget - used - 500));
      if (summary) {
        const section = `## 설계 결정사항\n${summary}`;
        sections.push(section);
        used += section.length;
      }
    }

    // 6. 킥오프 요약 (보충 맥락)
    if (state.kickoffSummary && budget - used > 200) {
      const kickoff = this._truncate(state.kickoffSummary, Math.min(500, budget - used - 100));
      if (kickoff) {
        const section = `## 킥오프 요약\n${kickoff}`;
        sections.push(section);
        used += section.length;
      }
    }

    // 7. 수정 지시 메시지
    const fixMessages = state.getMessagesFor(agentId, { type: "fix_guidance", taskId });
    if (fixMessages.length > 0) {
      const latest = fixMessages[fixMessages.length - 1];
      const fixSection = `## 팀장 수정 지시\n${latest.content}`;
      if (used + fixSection.length < budget) {
        sections.push(fixSection);
        used += fixSection.length;
      }
    }

    // 8. 이전 리뷰/QA 결과
    if (task?.review) {
      const section = `## 이전 리뷰 결과\n${task.review}`;
      if (used + section.length < budget) {
        sections.push(section);
        used += section.length;
      }
    }

    if (task?.qa) {
      const section = `## 이전 QA 결과\n${task.qa}`;
      if (used + section.length < budget) {
        sections.push(section);
        used += section.length;
      }
    }

    return {
      systemContext: sections.join("\n\n"),
      taskDescription: taskDesc,
      acceptanceCriteria: criteria,
    };
  }

  /**
   * 코드 리뷰용 맥락 조립
   * @param {import('./pipeline-state.js').PipelineState} state
   * @param {Object} opts
   * @param {string} opts.taskId
   * @param {string} [opts.codebaseContext] - 기존 코드베이스 맥락
   * @param {number} [opts.maxChars]
   * @returns {{ systemContext: string, code: string, criteria: string }}
   */
  forReview(state, { taskId, codebaseContext, maxChars } = {}) {
    const budget = maxChars || this.maxChars;
    const sections = [];
    let used = 0;

    const task = state.findTask(taskId);
    const code = task?.code || "";
    const criteria = task?.acceptance_criteria?.join("\n") || "";

    // 태스크 설명
    if (task?.description) {
      const section = `## 태스크 설명\n${task.description}`;
      sections.push(section);
      used += section.length;
    }

    // 기존 코드베이스 맥락
    if (codebaseContext && budget - used > 100) {
      const maxCodebase = Math.min(codebaseContext.length, Math.floor((budget - used) * 0.3));
      if (maxCodebase > 50) {
        const truncated = this._truncate(codebaseContext, maxCodebase);
        if (truncated) {
          const section = `## 기존 코드베이스 참고\n${truncated}`;
          sections.push(section);
          used += section.length;
        }
      }
    }

    // 설계 결정 요약
    if (state.designDecisions) {
      const summary = this._truncate(state.designDecisions, budget - used - 200);
      if (summary) {
        const section = `## 설계 결정 참고\n${summary}`;
        sections.push(section);
        used += section.length;
      }
    }

    // 킥오프 요약 (보충 맥락)
    if (state.kickoffSummary && budget - used > 200) {
      const kickoff = this._truncate(state.kickoffSummary, Math.min(500, budget - used - 100));
      if (kickoff) {
        const section = `## 킥오프 요약\n${kickoff}`;
        sections.push(section);
        used += section.length;
      }
    }

    // 이전 리뷰 이력 (재리뷰 시)
    if (task?.review) {
      const section = `## 이전 리뷰\n${task.review}`;
      if (used + section.length < budget) {
        sections.push(section);
        used += section.length;
      }
    }

    return {
      systemContext: sections.join("\n\n"),
      code,
      criteria,
    };
  }

  /**
   * QA용 맥락 조립
   * @param {import('./pipeline-state.js').PipelineState} state
   * @param {Object} opts
   * @param {string} opts.taskId
   * @param {number} [opts.maxChars]
   * @returns {{ systemContext: string, code: string, criteria: string, taskDescription: string }}
   */
  forQA(state, { taskId, maxChars } = {}) {
    const budget = maxChars || this.maxChars;
    const sections = [];
    let used = 0;

    const task = state.findTask(taskId);
    const code = task?.code || "";
    const criteria = task?.acceptance_criteria?.join("\n") || "";
    const taskDescription = task?.description || "";

    // 리뷰 결과
    if (task?.review) {
      const section = `## 코드 리뷰 결과\n${task.review}`;
      if (used + section.length < budget) {
        sections.push(section);
        used += section.length;
      }
    }

    // 이전 QA 결과 (재테스트 시)
    if (task?.qa) {
      const section = `## 이전 QA 결과\n${task.qa}`;
      if (used + section.length < budget) {
        sections.push(section);
        used += section.length;
      }
    }

    return {
      systemContext: sections.join("\n\n"),
      code,
      criteria,
      taskDescription,
    };
  }

  /**
   * 수정 작업용 맥락 조립
   * @param {import('./pipeline-state.js').PipelineState} state
   * @param {Object} opts
   * @param {string} opts.agentId
   * @param {string} opts.taskId
   * @param {"review"|"qa"} opts.feedbackSource
   * @param {number} [opts.maxChars]
   * @returns {{ systemContext: string, taskDescription: string, acceptanceCriteria: string, currentCode: string }}
   */
  forFix(state, { agentId, taskId, feedbackSource, maxChars } = {}) {
    const budget = maxChars || this.maxChars;
    const sections = [];
    let used = 0;

    const task = state.findTask(taskId);
    const currentCode = task?.code || "";

    // 1. 피드백 내용
    const feedback = feedbackSource === "review" ? task?.review : task?.qa;
    if (feedback) {
      const label = feedbackSource === "review" ? "리뷰" : "QA";
      const section = `## ${label} 피드백\n${feedback}`;
      sections.push(section);
      used += section.length;
    }

    // 2. 수정 지시
    const fixMessages = state.getMessagesFor(agentId, { type: "fix_guidance", taskId });
    if (fixMessages.length > 0) {
      const latest = fixMessages[fixMessages.length - 1];
      const section = `## 팀장 수정 지시\n${latest.content}`;
      if (used + section.length < budget) {
        sections.push(section);
        used += section.length;
      }
    }

    // 3. 설계 결정 (축약)
    if (state.designDecisions) {
      const summary = this._truncate(state.designDecisions, Math.min(1000, budget - used - 200));
      if (summary) {
        const section = `## 설계 참고\n${summary}`;
        sections.push(section);
        used += section.length;
      }
    }

    // 4. 킥오프 요약 (보충 맥락)
    if (state.kickoffSummary && budget - used > 200) {
      const kickoff = this._truncate(state.kickoffSummary, Math.min(500, budget - used - 100));
      if (kickoff) {
        const section = `## 킥오프 요약\n${kickoff}`;
        sections.push(section);
        used += section.length;
      }
    }

    return {
      systemContext: sections.join("\n\n"),
      taskDescription: task?.description || "",
      acceptanceCriteria: task?.acceptance_criteria?.join("\n") || "",
      currentCode,
    };
  }

  /**
   * 이미지 생성용 맥락 조립
   * @param {import('./pipeline-state.js').PipelineState} state
   * @param {Object} opts
   * @param {string} opts.imagePrompt
   * @param {string} [opts.taskId]
   * @param {string} [opts.outputDir]
   * @param {number} [opts.maxChars]
   * @returns {{ systemContext: string, imagePrompt: string, outputDir: string }}
   */
  forImageGeneration(state, { imagePrompt, taskId, outputDir, maxChars } = {}) {
    const budget = maxChars || this.maxChars;
    const sections = [];
    let used = 0;

    // 1. 프로젝트 정보
    const projectInfo = this._buildProjectSection(state);
    sections.push(projectInfo);
    used += projectInfo.length;

    // 2. 디자인 가이드라인
    if (state.designDecisions) {
      const summary = this._truncate(state.designDecisions, Math.min(2000, budget - used - 500));
      const section = `## 디자인 가이드라인\n${summary}`;
      sections.push(section);
      used += section.length;
    }

    // 3. 관련 태스크 설명
    if (taskId) {
      const task = state.findTask(taskId);
      if (task?.description) {
        const section = `## 관련 태스크\n${task.description}`;
        if (used + section.length < budget) {
          sections.push(section);
        }
      }
    }

    return {
      systemContext: sections.join("\n\n"),
      imagePrompt,
      outputDir: outputDir || "./output/images",
    };
  }

  // ─── 내부 헬퍼 ─────────────────────────────────────────

  /** @private */
  _buildProjectSection(state) {
    return `## 프로젝트: ${state.project.title}\n### 요구사항\n${state.project.requirement}`;
  }

  /** @private */
  _buildSpeechSection(speeches, maxChars) {
    const lines = ["## 이전 논의"];
    let used = lines[0].length;

    for (const msg of speeches) {
      const line = `**${msg.from}**: ${msg.content}`;
      if (used + line.length + 10 > maxChars) break;
      lines.push(line);
      used += line.length + 5;
    }

    return lines.length > 1 ? lines.join("\n\n") : null;
  }

  /** @private */
  _truncate(text, maxChars) {
    if (!text) return null;
    const str = typeof text === "string" ? text : JSON.stringify(text);
    if (str.length <= maxChars) return str;
    return str.substring(0, maxChars - 20) + "\n...(예산 내 절삭)";
  }
}
