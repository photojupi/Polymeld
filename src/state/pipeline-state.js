// src/state/pipeline-state.js
// 파이프라인 전체 상태를 관리하는 단일 데이터 객체

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

    // --- 메시지 로그 ---
    /** @type {Array<Message>} */
    this.messages = [];
    this._nextMsgId = 1;

    // --- 코드베이스 분석 (수정 모드) ---
    this.codebaseAnalysis = null;

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
   * 메시지 추가
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
      tasks: this.tasks.map(({ assignedAgent, ...rest }) => rest),
      completedTasks: this.completedTasks.map(({ assignedAgent, ...rest }) => rest),
      messages: this.messages,
      nextMsgId: this._nextMsgId,
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
      state.github = data.github || { kickoffIssue: null, designIssue: null };
      state.completedPhases = data.completedPhases || [];
    }

    return state;
  }
}
