// src/state/prompt-assembler.js
// 토큰 예산 내 프롬프트 맥락 조립기
// PipelineState에서 작업별 필요한 맥락을 우선순위 기반으로 조립

import { t } from "../i18n/index.js";

// Phase별 기본 예산 (문자 수)
// 각 Phase의 정보 필요량에 따라 차등 배분
const PHASE_BUDGETS = {
  meeting: 8000,   // 이전 발언이 많으므로 여유 확보
  coding:  18000,  // 코드 퀄리티 직결 → 가장 큰 예산 (target_files 전체 읽기 지원)
  review:  6000,   // 코드 자체는 별도 전달, 맥락만
  qa:      4000,   // 리뷰 결과 + 이전 QA만 참조
  fix:     10000,  // 피드백 + 수정 지시 + 설계 모두 필요
  image:   6000,
};

export class PromptAssembler {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxChars=6000] - 기본 최대 문자 수 (~1500 토큰)
   */
  constructor(options = {}) {
    this.maxChars = options.maxChars || 6000;
    // maxChars가 명시적으로 주어지면 모든 Phase에 동일 적용 (하위 호환)
    this._hasExplicitMaxChars = !!options.maxChars;
  }

  /** Phase별 차등 예산 해석. 명시적 override → constructor maxChars → Phase 기본값 */
  _resolveBudget(phase, maxCharsOverride) {
    if (maxCharsOverride) return maxCharsOverride;
    if (this._hasExplicitMaxChars) return this.maxChars;
    return PHASE_BUDGETS[phase] || this.maxChars;
  }

  /**
   * 회의 발언용 맥락 조립
   */
  forMeeting(state, { agentId, topic, maxPreviousSpeeches = 8, maxChars } = {}) {
    const budget = this._resolveBudget("meeting", maxChars);
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
    // 최소 800자를 보장하여 후반 라운드에서도 코드베이스 정보 유지
    if (state.codebaseAnalysis && budget - used > 200) {
      const maxCodebase = Math.max(800, Math.floor((budget - used) * 0.3));
      const truncated = this._truncate(state.codebaseAnalysis, maxCodebase);
      if (truncated) {
        const section = `${t("promptAssembler.codebaseAnalysis")}\n${truncated}`;
        sections.push(section);
        used += section.length;
      }
    }

    // 4. 설계 결정 요약
    if (used < budget - 500 && state.designDecisions) {
      const summary = this._truncate(state.designDecisions, budget - used - 100);
      if (summary) {
        const section = `${t("promptAssembler.designDecisions")}\n${summary}`;
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
   */
  forCoding(state, { agentId, taskId, codebaseContext, maxChars } = {}) {
    const budget = this._resolveBudget("coding", maxChars);
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

    // fix 사이클 판정: 수정 지시가 있으면 수정 모드
    const fixMessages = state.getMessagesFor(agentId, { type: "fix_guidance", taskId });
    const isFixCycle = fixMessages.length > 0;

    if (isFixCycle) {
      // === 수정 코딩: 피드백 이해가 최우선 ===

      // 2a. 수정 지시 (최우선, 전체 포함)
      const latest = fixMessages[fixMessages.length - 1];
      const fixSection = `${t("promptAssembler.leadFixGuidance")}\n${latest.content}`;
      sections.push(fixSection);
      used += fixSection.length;

      // 2b. 이전 리뷰/QA 결과 (수정 대상이므로 우선 포함)
      if (task?.review && budget - used > 200) {
        const reviewContent = this._truncate(task.review, Math.min(1500, budget - used - 200));
        if (reviewContent) {
          const section = `${t("promptAssembler.previousReview")}\n${reviewContent}`;
          sections.push(section);
          used += section.length;
        }
      }

      if (task?.qa && budget - used > 200) {
        const qaContent = this._truncate(task.qa, Math.min(1000, budget - used - 200));
        if (qaContent) {
          const section = `${t("promptAssembler.previousQA")}\n${qaContent}`;
          sections.push(section);
          used += section.length;
        }
      }

      // 2c. 코드베이스 (남은 예산의 40%)
      if (codebaseContext && budget - used > 100) {
        const maxCodebase = Math.min(codebaseContext.length, Math.floor((budget - used) * 0.4));
        if (maxCodebase > 50) {
          const truncated = this._truncate(codebaseContext, maxCodebase);
          if (truncated) {
            const section = `${t("promptAssembler.codebaseRef")}\n${truncated}`;
            sections.push(section);
            used += section.length;
          }
        }
      }

      // 2d. 설계 결정 (축소)
      if (state.designDecisions && budget - used > 200) {
        const summary = this._truncate(state.designDecisions, Math.min(1000, budget - used - 100));
        if (summary) {
          const section = `${t("promptAssembler.designDecisionsRef")}\n${summary}`;
          sections.push(section);
          used += section.length;
        }
      }
    } else {
      // === 최초 코딩: 코드베이스 이해가 최우선 ===

      // 3. 기존 코드베이스 맥락 (50% 할당)
      if (codebaseContext && budget - used > 100) {
        const maxCodebase = Math.min(codebaseContext.length, Math.floor((budget - used) * 0.5));
        if (maxCodebase > 50) {
          const truncated = this._truncate(codebaseContext, maxCodebase);
          if (truncated) {
            const section = `${t("promptAssembler.codebaseRef")}\n${truncated}`;
            sections.push(section);
            used += section.length;
          }
        }
      }

      // 4. 기술 스택
      if (state.techStack) {
        const valueStr = typeof state.techStack === "string"
          ? state.techStack : JSON.stringify(state.techStack, null, 2);
        const techSection = `${t("promptAssembler.techStack")}\n${valueStr}`;
        if (used + techSection.length < budget) {
          sections.push(techSection);
          used += techSection.length;
        }
      }

      // 5. 설계 결정 (남은 예산의 30%, cap 2500자)
      if (state.designDecisions) {
        const designBudget = Math.min(2500, Math.floor((budget - used) * 0.3));
        const summary = this._truncate(state.designDecisions, Math.max(0, Math.min(designBudget, budget - used - 200)));
        if (summary) {
          const section = `${t("promptAssembler.designDecisionsRef")}\n${summary}`;
          sections.push(section);
          used += section.length;
        }
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
   */
  forReview(state, { taskId, codebaseContext, maxChars } = {}) {
    const budget = this._resolveBudget("review", maxChars);
    const sections = [];
    let used = 0;

    const task = state.findTask(taskId);
    const code = task?.code || "";
    const criteria = task?.acceptance_criteria?.join("\n") || "";

    // 태스크 설명
    if (task?.description) {
      const section = `${t("promptAssembler.taskDescription")}\n${task.description}`;
      sections.push(section);
      used += section.length;
    }

    // 기존 코드베이스 맥락
    if (codebaseContext && budget - used > 100) {
      const maxCodebase = Math.min(codebaseContext.length, Math.floor((budget - used) * 0.3));
      if (maxCodebase > 50) {
        const truncated = this._truncate(codebaseContext, maxCodebase);
        if (truncated) {
          const section = `${t("promptAssembler.codebaseRef")}\n${truncated}`;
          sections.push(section);
          used += section.length;
        }
      }
    }

    // 설계 결정 요약
    if (state.designDecisions) {
      const summary = this._truncate(state.designDecisions, budget - used - 200);
      if (summary) {
        const section = `${t("promptAssembler.designDecisions")}\n${summary}`;
        sections.push(section);
        used += section.length;
      }
    }

    // 이전 리뷰 이력 (재리뷰 시)
    if (task?.review) {
      const section = `${t("promptAssembler.previousReview")}\n${task.review}`;
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
   */
  forQA(state, { taskId, maxChars } = {}) {
    const budget = this._resolveBudget("qa", maxChars);
    const sections = [];
    let used = 0;

    const task = state.findTask(taskId);
    const code = task?.code || "";
    const criteria = task?.acceptance_criteria?.join("\n") || "";
    const taskDescription = task?.description || "";

    // 리뷰 결과
    if (task?.review) {
      const section = `${t("promptAssembler.reviewResult")}\n${task.review}`;
      if (used + section.length < budget) {
        sections.push(section);
        used += section.length;
      }
    }

    // 이전 QA 결과 (재테스트 시)
    if (task?.qa) {
      const section = `${t("promptAssembler.previousQAResult")}\n${task.qa}`;
      if (used + section.length < budget) {
        sections.push(section);
        used += section.length;
      }
    }

    const filePaths = task?.filePaths || (task?.filePath ? [task.filePath] : []);

    return {
      systemContext: sections.join("\n\n"),
      code,
      criteria,
      taskDescription,
      filePaths,
    };
  }

  /**
   * 수정 작업용 맥락 조립
   */
  forFix(state, { agentId, taskId, feedbackSource, maxChars } = {}) {
    const budget = this._resolveBudget("fix", maxChars);
    const sections = [];
    let used = 0;

    const task = state.findTask(taskId);
    const currentCode = task?.code || "";

    // 1. 피드백 내용
    const feedback = feedbackSource === "review" ? task?.review : task?.qa;
    if (feedback) {
      const label = feedbackSource === "review"
        ? t("promptAssembler.reviewFeedback")
        : t("promptAssembler.qaFeedback");
      const section = `${label}\n${feedback}`;
      sections.push(section);
      used += section.length;
    }

    // 2. 수정 지시 (최근 2개까지, 이전 것은 축약)
    const fixMessages = state.getMessagesFor(agentId, { type: "fix_guidance", taskId });
    if (fixMessages.length > 0) {
      const recentFixes = fixMessages.slice(-2);
      const parts = recentFixes.map((msg, i) => {
        const isLatest = i === recentFixes.length - 1;
        const content = isLatest ? msg.content : this._truncate(msg.content, 500);
        return isLatest
          ? `${t("promptAssembler.currentFixGuidance")}\n${content}`
          : `${t("promptAssembler.previousFixGuidance")}\n${content}`;
      });
      const section = `${t("promptAssembler.fixGuidanceSection")}\n${parts.join("\n\n")}`;
      if (used + section.length < budget) {
        sections.push(section);
        used += section.length;
      }
    }

    // 3. 설계 결정 (축약)
    if (state.designDecisions) {
      const summary = this._truncate(state.designDecisions, Math.min(1000, budget - used - 200));
      if (summary) {
        const section = `${t("promptAssembler.designRef")}\n${summary}`;
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
   */
  forImageGeneration(state, { imagePrompt, taskId, outputDir, maxChars } = {}) {
    const budget = this._resolveBudget("image", maxChars);
    const sections = [];
    let used = 0;

    // 1. 프로젝트 정보
    const projectInfo = this._buildProjectSection(state);
    sections.push(projectInfo);
    used += projectInfo.length;

    // 2. 디자인 가이드라인
    if (state.designDecisions) {
      const summary = this._truncate(state.designDecisions, Math.min(2000, budget - used - 500));
      const section = `${t("promptAssembler.designGuideline")}\n${summary}`;
      sections.push(section);
      used += section.length;
    }

    // 3. 관련 태스크 설명
    if (taskId) {
      const task = state.findTask(taskId);
      if (task?.description) {
        const section = `${t("promptAssembler.relatedTask")}\n${task.description}`;
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
    return `${t("promptAssembler.project", { title: state.project.title })}\n${t("promptAssembler.requirementSection")}\n${state.project.requirement}`;
  }

  /** @private */
  _buildSpeechSection(speeches, maxChars) {
    const header = t("promptAssembler.previousDiscussion");
    const lines = [header];
    let used = header.length;

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
    return str.substring(0, maxChars - 20) + `\n${t("promptAssembler.truncated")}`;
  }
}
