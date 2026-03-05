// src/context/context-builder.js
// 토큰 예산 내 프롬프트 맥락 조립기
// SharedContext + Mailbox에서 특정 작업에 필요한 맥락을 우선순위 기반으로 조립

/**
 * 토큰 예산 내 프롬프트 맥락 조립기
 *
 * 설계 철학:
 * - SharedContext + Mailbox에서 특정 작업에 필요한 맥락을 우선순위 기반으로 조립
 * - maxChars 예산을 초과하지 않도록 제어
 * - 각 작업 유형(회의, 코딩, 리뷰, QA, 수정)별 최적화된 조립 전략
 * - summary 폴백: 예산 부족 시 요약 버전 사용
 *
 * 조립 우선순위:
 *   1. [필수] project.requirement + project.title (~500자)
 *   2. [작업별 필수] 태스크/코드 등 (~2000자)
 *   3. [소통 맥락] inbox 메시지 (~2000자)
 *   4. [보조 참조] 설계/요약 (~1500자, 잔여 예산)
 */
export class ContextBuilder {
  /**
   * @param {import('./shared-context.js').SharedContext} sharedContext
   * @param {import('./mailbox.js').Mailbox} mailbox
   * @param {Object} [options]
   * @param {number} [options.maxChars=6000] - 기본 최대 문자 수 (~1500 토큰)
   */
  constructor(sharedContext, mailbox, options = {}) {
    this.shared = sharedContext;
    this.mailbox = mailbox;
    this.maxChars = options.maxChars || 6000;
  }

  /**
   * 회의 발언용 맥락 조립
   *
   * 우선순위:
   * 1. [필수] project.requirement + project.title
   * 2. [필수] 회의 주제 (파라미터)
   * 3. [작업별] 최근 N개 회의 발언 (Mailbox, 최신순 제한)
   * 4. [보조] design.decisions 요약 (있을 경우)
   *
   * @param {string} agentId
   * @param {string} topic - 현재 회의 주제
   * @param {Object} [options]
   * @param {number} [options.maxChars] - 오버라이드
   * @param {number} [options.maxPreviousSpeeches=8] - 이전 발언 최대 수
   * @returns {{ context: string, topic: string }}
   */
  buildForMeeting(agentId, topic, options = {}) {
    const budget = options.maxChars || this.maxChars;
    const maxSpeeches = options.maxPreviousSpeeches || 8;
    const sections = [];
    let used = 0;

    // 1. 필수: 프로젝트 정보
    const projectInfo = this._buildProjectSection();
    sections.push(projectInfo);
    used += projectInfo.length;

    // 2. 필수: 회의 주제 (topic은 별도 반환, context에는 미포함)

    // 3. 작업별: 최근 회의 발언 (Mailbox에서)
    const speechMessages = this.mailbox.getInbox(agentId, { type: "meeting_speech" });
    const recentSpeeches = speechMessages.slice(-maxSpeeches);

    if (recentSpeeches.length > 0) {
      const speechSection = this._buildSpeechSection(recentSpeeches, budget - used);
      if (speechSection) {
        sections.push(speechSection);
        used += speechSection.length;
      }
    }

    // 4. 보조: 설계 결정 요약
    if (used < budget - 500) {
      const designSummary = this._getSlotSummaryOrTruncate(
        "design.decisions", budget - used - 100
      );
      if (designSummary) {
        const section = `## 설계 결정 참고\n${designSummary}`;
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
   *
   * 우선순위:
   * 1. [필수] project.requirement + project.title
   * 2. [필수] 해당 태스크 정보 (planning.tasks에서)
   * 3. [작업별] design.techStack + design.decisions (요약)
   * 4. [소통] task_assignment 메시지
   * 5. [보조] 이전 리뷰/QA 피드백 (재수정 시)
   *
   * @param {string} agentId
   * @param {string} taskId
   * @param {Object} [options]
   * @returns {{ systemContext: string, taskDescription: string, acceptanceCriteria: string }}
   */
  buildForCoding(agentId, taskId, options = {}) {
    const budget = options.maxChars || this.maxChars;
    const sections = [];
    let used = 0;

    // 1. 필수: 프로젝트 정보
    const projectInfo = this._buildProjectSection();
    sections.push(projectInfo);
    used += projectInfo.length;

    // 2. 필수: 태스크 정보
    const task = this._findTask(taskId);
    const taskDesc = task?.description || "";
    const criteria = task?.acceptance_criteria?.join("\n") || "";

    // 3. 작업별: 기술 스택 + 설계 결정
    const techStack = this.shared.get("design.techStack");
    if (techStack) {
      const techSection = `## 기술 스택\n${this.shared._valueToString(techStack)}`;
      if (used + techSection.length < budget) {
        sections.push(techSection);
        used += techSection.length;
      }
    }

    const designSummary = this._getSlotSummaryOrTruncate(
      "design.decisions", Math.min(2000, budget - used - 500)
    );
    if (designSummary) {
      const section = `## 설계 결정사항\n${designSummary}`;
      sections.push(section);
      used += section.length;
    }

    // 4. 소통: fix_guidance, review_feedback (재수정 시)
    const fixMessages = this.mailbox.getInbox(agentId, {
      type: "fix_guidance",
      unreadOnly: true
    }).filter(m => m.payload?.taskId === taskId);

    if (fixMessages.length > 0) {
      const latestFix = fixMessages[fixMessages.length - 1];
      const fixSection = `## 팀장 수정 지시\n${latestFix.payload.content}`;
      if (used + fixSection.length < budget) {
        sections.push(fixSection);
        used += fixSection.length;
      }
    }

    // 5. 보조: 이전 리뷰/QA 결과
    const reviewContent = this.shared.get(`review.${taskId}`);
    if (reviewContent && used + reviewContent.length < budget) {
      const section = `## 이전 리뷰 결과\n${reviewContent}`;
      if (used + section.length < budget) {
        sections.push(section);
        used += section.length;
      }
    }

    const qaContent = this.shared.get(`qa.${taskId}`);
    if (qaContent) {
      const section = `## 이전 QA 결과\n${qaContent}`;
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
   *
   * 우선순위:
   * 1. [필수] 코드 아티팩트 (code.<taskId>)
   * 2. [필수] 수용 기준
   * 3. [작업별] 태스크 설명
   * 4. [보조] design.decisions 요약
   *
   * @param {string} agentId
   * @param {string} taskId
   * @param {Object} [options]
   * @returns {{ systemContext: string, code: string, criteria: string }}
   */
  buildForReview(agentId, taskId, options = {}) {
    const budget = options.maxChars || this.maxChars;
    const sections = [];
    let used = 0;

    // 1. 필수: 코드 (별도 반환, 예산에서 제외)
    const code = this.shared.get(`code.${taskId}`) || "";

    // 2. 필수: 수용 기준
    const task = this._findTask(taskId);
    const criteria = task?.acceptance_criteria?.join("\n") || "";

    // 3. 작업별: 태스크 설명
    if (task?.description) {
      const section = `## 태스크 설명\n${task.description}`;
      sections.push(section);
      used += section.length;
    }

    // 4. 보조: 설계 결정 요약
    const designSummary = this._getSlotSummaryOrTruncate(
      "design.decisions", budget - used - 200
    );
    if (designSummary) {
      const section = `## 설계 결정 참고\n${designSummary}`;
      sections.push(section);
      used += section.length;
    }

    // 5. 보조: 이전 리뷰 이력 (재리뷰 시)
    const previousReview = this.shared.get(`review.${taskId}`);
    if (previousReview) {
      const section = `## 이전 리뷰\n${previousReview}`;
      if (used + section.length < budget) {
        sections.push(section);
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
   *
   * @param {string} agentId
   * @param {string} taskId
   * @param {Object} [options]
   * @returns {{ systemContext: string, code: string, criteria: string, taskDescription: string }}
   */
  buildForQA(agentId, taskId, options = {}) {
    const budget = options.maxChars || this.maxChars;
    const sections = [];
    let used = 0;

    const code = this.shared.get(`code.${taskId}`) || "";
    const task = this._findTask(taskId);
    const criteria = task?.acceptance_criteria?.join("\n") || "";
    const taskDescription = task?.description || "";

    // 보조: 리뷰 결과
    const reviewContent = this.shared.get(`review.${taskId}`);
    if (reviewContent) {
      const section = `## 코드 리뷰 결과\n${reviewContent}`;
      if (used + section.length < budget) {
        sections.push(section);
        used += section.length;
      }
    }

    // 보조: 이전 QA 결과 (재테스트 시)
    const previousQA = this.shared.get(`qa.${taskId}`);
    if (previousQA) {
      const section = `## 이전 QA 결과\n${previousQA}`;
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
   * 수정 작업용 맥락 조립 (리뷰/QA 피드백 반영)
   * 코딩용과 유사하나, 피드백 메시지를 최우선으로 포함
   *
   * @param {string} agentId
   * @param {string} taskId
   * @param {"review"|"qa"} feedbackSource - 피드백 출처
   * @param {Object} [options]
   * @returns {{ systemContext: string, taskDescription: string, acceptanceCriteria: string, currentCode: string }}
   */
  buildForFix(agentId, taskId, feedbackSource, options = {}) {
    const budget = options.maxChars || this.maxChars;
    const sections = [];
    let used = 0;

    // 1. 현재 코드
    const currentCode = this.shared.get(`code.${taskId}`) || "";

    // 2. 필수: 피드백 내용
    const feedbackSlot = feedbackSource === "review"
      ? `review.${taskId}`
      : `qa.${taskId}`;
    const feedback = this.shared.get(feedbackSlot);
    if (feedback) {
      const section = `## ${feedbackSource === "review" ? "리뷰" : "QA"} 피드백\n${feedback}`;
      sections.push(section);
      used += section.length;
    }

    // 3. 수정 지시 (Mailbox)
    const fixMessages = this.mailbox.getInbox(agentId, { type: "fix_guidance" })
      .filter(m => m.payload?.taskId === taskId);

    if (fixMessages.length > 0) {
      const latest = fixMessages[fixMessages.length - 1];
      const section = `## 팀장 수정 지시\n${latest.payload.content}`;
      if (used + section.length < budget) {
        sections.push(section);
        used += section.length;
      }
    }

    // 4. 태스크 기본 정보
    const task = this._findTask(taskId);

    // 5. 설계 결정 (축약)
    const designSummary = this._getSlotSummaryOrTruncate(
      "design.decisions", Math.min(1000, budget - used - 200)
    );
    if (designSummary) {
      const section = `## 설계 참고\n${designSummary}`;
      sections.push(section);
    }

    return {
      systemContext: sections.join("\n\n"),
      taskDescription: task?.description || "",
      acceptanceCriteria: task?.acceptance_criteria?.join("\n") || "",
      currentCode,
    };
  }

  // ─── 내부 헬퍼 ─────────────────────────────────────────

  /**
   * 이미지 생성용 맥락 조립
   *
   * 우선순위:
   * 1. [필수] project.requirement + project.title
   * 2. [작업별] design.decisions (디자인 가이드라인)
   * 3. [보조] 관련 태스크 설명
   *
   * @param {string} agentId
   * @param {string} imagePrompt - 이미지 생성 프롬프트
   * @param {Object} [options]
   * @param {string} [options.taskId] - 관련 태스크 ID
   * @param {string} [options.outputDir] - 이미지 저장 경로
   * @returns {{ systemContext: string, imagePrompt: string, outputDir: string }}
   */
  buildForImageGeneration(agentId, imagePrompt, options = {}) {
    const budget = options.maxChars || this.maxChars;
    const sections = [];
    let used = 0;

    // 1. 필수: 프로젝트 정보
    const projectInfo = this._buildProjectSection();
    sections.push(projectInfo);
    used += projectInfo.length;

    // 2. 작업별: 디자인 가이드라인
    const designSummary = this._getSlotSummaryOrTruncate(
      "design.decisions", Math.min(2000, budget - used - 500)
    );
    if (designSummary) {
      const section = `## 디자인 가이드라인\n${designSummary}`;
      sections.push(section);
      used += section.length;
    }

    // 3. 보조: 관련 태스크 설명
    if (options.taskId) {
      const task = this._findTask(options.taskId);
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
      outputDir: options.outputDir || "./output/images",
    };
  }

  /**
   * 프로젝트 기본 정보 섹션 생성
   * @private
   */
  _buildProjectSection() {
    const title = this.shared.get("project.title") || "";
    const req = this.shared.get("project.requirement") || "";
    return `## 프로젝트: ${title}\n### 요구사항\n${req}`;
  }

  /**
   * 회의 발언 섹션 생성 (예산 내)
   * @private
   */
  _buildSpeechSection(speeches, maxChars) {
    const lines = ["## 이전 논의"];
    let used = lines[0].length;

    for (const msg of speeches) {
      const line = `**${msg.from}**: ${msg.payload.content}`;
      if (used + line.length + 10 > maxChars) break;
      lines.push(line);
      used += line.length + 5;
    }

    return lines.length > 1 ? lines.join("\n\n") : null;
  }

  /**
   * 슬롯의 summary 또는 truncated 값 반환
   * @private
   */
  _getSlotSummaryOrTruncate(slotName, maxChars) {
    const slot = this.shared.getWithMeta(slotName);
    if (!slot) return null;

    // summary가 있고 예산 내이면 summary 사용
    if (slot.metadata.summary && slot.metadata.summary.length <= maxChars) {
      return slot.metadata.summary;
    }

    // 값을 직접 truncate
    const valueStr = typeof slot.value === "string"
      ? slot.value
      : JSON.stringify(slot.value);

    if (valueStr.length <= maxChars) return valueStr;

    return valueStr.substring(0, maxChars - 20) + "\n...(예산 내 절삭)";
  }

  /**
   * planning.tasks 슬롯에서 taskId로 태스크 찾기
   * @private
   */
  _findTask(taskId) {
    const tasks = this.shared.get("planning.tasks");
    if (!Array.isArray(tasks)) return null;
    return tasks.find(t => t.id === taskId || t.title === taskId);
  }
}
