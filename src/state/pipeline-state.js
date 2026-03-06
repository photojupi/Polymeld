// src/state/pipeline-state.js
// 파이프라인 전체 상태를 관리하는 단일 데이터 객체
// SharedContext + Mailbox를 대체하는 명시적 구조체

export class PipelineState {
  constructor() {
    // --- 프로젝트 기본 ---
    this.project = { requirement: "", title: "" };

    // --- Phase 결과물 ---
    this.kickoffSummary = "";
    this.designDecisions = "";
    this.techStack = "";

    // --- 태스크 ---
    /** @type {Array<Task>} */
    this.tasks = [];
    /** @type {Array<Object>} */
    this.completedTasks = [];

    // --- 메시지 로그 (Mailbox 대체) ---
    /** @type {Array<Message>} */
    this.messages = [];
    this._nextMsgId = 1;

    // --- 코드베이스 분석 (수정 모드) ---
    this.codebaseAnalysis = null;

    // --- 팀 상태 ---
    this.mobilizedAgents = [];

    // --- GitHub 메타 ---
    this.github = { kickoffIssue: null, designIssue: null };

    // --- Phase 체크포인트 ---
    /** @type {string[]} 완료된 Phase ID 목록 (e.g., ["kickoff", "design"]) */
    this.completedPhases = [];
  }

  /**
   * taskId로 태스크 조회
   * @param {string} taskId
   * @returns {Object|undefined}
   */
  findTask(taskId) {
    return this.tasks.find((t) => t.id === taskId || t.title === taskId);
  }

  /**
   * 특정 태스크 관련 메시지 조회
   * @param {string} taskId
   * @returns {Array<Object>}
   */
  getTaskMessages(taskId) {
    return this.messages.filter((m) => m.taskId === taskId);
  }

  /**
   * 메시지 추가 (Mailbox.send 대체)
   */
  addMessage({ from, to, type, content, taskId = null }) {
    const msg = {
      id: this._nextMsgId++,
      from,
      to,
      type,
      content,
      taskId,
      timestamp: new Date().toISOString(),
    };
    this.messages.push(msg);
    return msg;
  }

  /**
   * 브로드캐스트 메시지 (회의 발언 등)
   * Mailbox.broadcast와 달리 복제하지 않고 단일 메시지로 기록
   */
  broadcastMessage({ from, type, content, taskId = null }) {
    return this.addMessage({ from, to: "all", type, content, taskId });
  }

  /**
   * 메시지 로그를 마크다운으로 내보내기 (phasePR에서 사용)
   * @param {Object} [options]
   * @param {string} [options.taskId] - 특정 태스크만
   * @returns {string}
   */
  exportMessageLog({ taskId } = {}) {
    let msgs = this.messages;
    if (taskId) msgs = msgs.filter((m) => m.taskId === taskId);

    if (msgs.length === 0) return "(소통 이력 없음)";

    const lines = ["## 메시지 로그\n"];
    for (const msg of msgs) {
      lines.push(`- **${msg.from}** → **${msg.to}** \`${msg.type}\` (${msg.timestamp})`);
      if (msg.content) {
        const preview = msg.content.substring(0, 200);
        lines.push(`  > ${preview}${msg.content.length > 200 ? "..." : ""}`);
      }
    }
    return lines.join("\n");
  }

  /**
   * 특정 에이전트에게 온 특정 타입 메시지 조회 (PromptAssembler에서 사용)
   * @param {string} agentId
   * @param {Object} [options]
   * @param {string} [options.type]
   * @param {string} [options.taskId]
   * @returns {Array<Object>}
   */
  getMessagesFor(agentId, { type, taskId } = {}) {
    return this.messages.filter((m) => {
      if (m.to !== agentId && m.to !== "all") return false;
      if (type && m.type !== type) return false;
      if (taskId && m.taskId !== taskId) return false;
      return true;
    });
  }

  // --- Phase 체크포인트 ---

  markPhaseComplete(phaseId) {
    if (!this.completedPhases.includes(phaseId)) {
      this.completedPhases.push(phaseId);
    }
  }

  isPhaseComplete(phaseId) {
    return this.completedPhases.includes(phaseId);
  }

  /**
   * completedPhases를 리셋 (새 파이프라인 실행 시)
   */
  resetPhases() {
    this.completedPhases = [];
  }

  // --- 직렬화 ---

  toJSON() {
    return {
      version: 1,
      project: this.project,
      kickoffSummary: this.kickoffSummary,
      designDecisions: this.designDecisions,
      techStack: this.techStack,
      codebaseAnalysis: this.codebaseAnalysis,
      tasks: this.tasks,
      completedTasks: this.completedTasks,
      messages: this.messages,
      nextMsgId: this._nextMsgId,
      mobilizedAgents: this.mobilizedAgents,
      github: this.github,
      completedPhases: this.completedPhases,
    };
  }

  static fromJSON(data) {
    const state = new PipelineState();

    if (data.version === 1) {
      state.project = data.project || { requirement: "", title: "" };
      state.kickoffSummary = data.kickoffSummary || "";
      state.designDecisions = data.designDecisions || "";
      state.techStack = data.techStack || "";
      state.codebaseAnalysis = data.codebaseAnalysis || null;
      state.tasks = data.tasks || [];
      state.completedTasks = data.completedTasks || [];
      state.messages = data.messages || [];
      state._nextMsgId = data.nextMsgId || 1;
      state.mobilizedAgents = data.mobilizedAgents || [];
      state.github = data.github || { kickoffIssue: null, designIssue: null };
      state.completedPhases = data.completedPhases || [];
    } else {
      // v0: 기존 SharedContext + Mailbox 포맷 마이그레이션
      state._migrateFromV0(data);
    }

    return state;
  }

  /**
   * 기존 세션 데이터(SharedContext + Mailbox) → PipelineState 변환
   * @private
   */
  _migrateFromV0(data) {
    const slots = data.sharedContext?.slots || {};
    const getVal = (name) => slots[name]?.value;

    this.project.requirement = getVal("project.requirement") || "";
    this.project.title = getVal("project.title") || "";
    this.kickoffSummary = getVal("meeting.kickoff.summary") || "";
    this.designDecisions = getVal("design.decisions") || "";
    this.techStack = getVal("design.techStack") || "";
    this.mobilizedAgents = getVal("team.mobilizedAgents") || [];

    // tasks 마이그레이션: planning.tasks + 개별 code/review/qa 슬롯 병합
    const rawTasks = getVal("planning.tasks");
    if (Array.isArray(rawTasks)) {
      this.tasks = rawTasks.map((t) => ({
        ...t,
        code: getVal(`code.${t.id}`) || null,
        codeSummary: getVal(`code.${t.id}.summary`) || null,
        review: getVal(`review.${t.id}`) || null,
        reviewVerdict: getVal(`review.${t.id}.verdict`) || null,
        qa: getVal(`qa.${t.id}`) || null,
        qaVerdict: getVal(`qa.${t.id}.verdict`) || null,
        images: getVal(`image.${t.id}`) || null,
      }));
    }

    // Mailbox 메시지 마이그레이션
    if (data.mailbox?.allMessages) {
      this.messages = data.mailbox.allMessages.map((m) => ({
        id: m.id,
        from: m.from,
        to: m.to,
        type: m.type,
        content: m.payload?.content || "",
        taskId: m.payload?.taskId || null,
        timestamp: m.timestamp,
      }));
      this._nextMsgId = data.mailbox.nextId || this.messages.length + 1;
    }
  }
}
