// src/context/mailbox.js
// 에이전트 간 메시지 전달 시스템
// 각 에이전트에게 전용 수신함(inbox)을 부여하여 타입별/발신자별 메시지 관리

/**
 * @typedef {"meeting_speech"|"review_request"|"review_feedback"|"fix_guidance"|"qa_request"|"qa_result"|"task_assignment"} MessageType
 */

/**
 * 메시지 타입별 용도와 payload 구조:
 *
 * meeting_speech:
 *   from: 발언자 agentId
 *   to: broadcast (각 에이전트에게 개별 전송)
 *   payload: { content: "발언 내용", round: 1, isSummary: false }
 *
 * review_request:
 *   from: 개발자 agentId
 *   to: "tech_lead"
 *   payload: { content: "리뷰 요청", taskId: "task-1" }
 *
 * review_feedback:
 *   from: "tech_lead"
 *   to: 개발자 agentId
 *   payload: { content: "리뷰 결과", taskId: "task-1", verdict: "approved"|"changes_requested" }
 *
 * fix_guidance:
 *   from: "tech_lead"
 *   to: 개발자 agentId
 *   payload: { content: "수정 지시", taskId: "task-1" }
 *
 * qa_request:
 *   from: "orchestrator"
 *   to: "qa"
 *   payload: { content: "QA 요청", taskId: "task-1" }
 *
 * qa_result:
 *   from: "qa"
 *   to: "tech_lead" 또는 개발자
 *   payload: { content: "QA 결과", taskId: "task-1", verdict: "pass"|"fail" }
 *
 * task_assignment:
 *   from: "tech_lead"
 *   to: 담당자 agentId
 *   payload: { content: "태스크 배정", taskId: "task-1", taskTitle: "..." }
 */

/**
 * 에이전트 간 메시지 전달 시스템
 *
 * 설계 철학:
 * - 각 에이전트에게 전용 수신함 (inbox) 부여
 * - 타입별 메시지 분류로 선택적 참조 가능
 * - 스레드 지원으로 대화 맥락 추적
 * - 읽음/안읽음 관리로 새 메시지만 효율적으로 참조
 */
export class Mailbox {
  constructor() {
    /** @type {Map<string, Array<Object>>} agentId -> 수신 메시지 배열 */
    this.inboxes = new Map();

    /** @type {Array<Object>} 전체 메시지 로그 */
    this.allMessages = [];

    /** @type {number} 메시지 ID 시퀀스 */
    this._nextId = 1;
  }

  /**
   * 에이전트 수신함 초기화 (Team 생성 시 호출)
   * @param {string[]} agentIds
   */
  registerAgents(agentIds) {
    for (const id of agentIds) {
      if (!this.inboxes.has(id)) {
        this.inboxes.set(id, []);
      }
    }
  }

  /**
   * 1:1 메시지 전송
   * @param {Object} params
   * @param {string} params.from - 발신자 agentId
   * @param {string} params.to - 수신자 agentId
   * @param {MessageType} params.type - 메시지 타입
   * @param {Object} params.payload - 메시지 내용
   * @param {string} [params.payload.content] - 텍스트 내용
   * @param {string} [params.payload.taskId] - 관련 태스크 ID
   * @param {Object} [params.payload.meta] - 추가 메타데이터
   * @param {number} [params.replyTo] - 응답 대상 메시지 ID
   * @returns {Object} 전송된 메시지
   */
  send({ from, to, type, payload, replyTo = null }) {
    const message = {
      id: this._nextId++,
      from,
      to,
      type,
      payload,
      replyTo,
      timestamp: new Date().toISOString(),
      read: false,
    };

    // 수신함에 추가
    const inbox = this.inboxes.get(to);
    if (inbox) {
      inbox.push(message);
    }

    // 전체 로그에 추가
    this.allMessages.push(message);

    return message;
  }

  /**
   * 브로드캐스트 (회의 발언 등)
   * @param {Object} params
   * @param {string} params.from - 발신자 agentId
   * @param {MessageType} params.type - 메시지 타입
   * @param {Object} params.payload - 메시지 내용
   * @param {string[]} [params.exclude] - 제외할 agentId (자기 자신 등)
   * @returns {Array<Object>} 전송된 메시지들
   */
  broadcast({ from, type, payload, exclude = [] }) {
    const messages = [];
    for (const [agentId] of this.inboxes) {
      if (agentId === from || exclude.includes(agentId)) continue;

      const message = this.send({ from, to: agentId, type, payload });
      messages.push(message);
    }
    return messages;
  }

  /**
   * 수신함 조회
   * @param {string} agentId
   * @param {Object} [options]
   * @param {MessageType} [options.type] - 타입 필터
   * @param {boolean} [options.unreadOnly=false] - 안읽은 메시지만
   * @param {string} [options.since] - ISO 날짜 이후만
   * @param {string} [options.from] - 특정 발신자만
   * @returns {Array<Object>}
   */
  getInbox(agentId, { type, unreadOnly = false, since, from } = {}) {
    let messages = this.inboxes.get(agentId) || [];

    if (type) messages = messages.filter(m => m.type === type);
    if (unreadOnly) messages = messages.filter(m => !m.read);
    if (since) messages = messages.filter(m => m.timestamp >= since);
    if (from) messages = messages.filter(m => m.from === from);

    return messages;
  }

  /**
   * 특정 메시지에 대한 스레드 조회 (replyTo 체인)
   * @param {number} messageId
   * @returns {Array<Object>} 시간순 정렬된 스레드
   */
  getThread(messageId) {
    const visited = new Set();

    // 원본 메시지부터 시작하여 상위로 추적
    let current = this.allMessages.find(m => m.id === messageId);
    const ancestors = [];
    while (current) {
      if (visited.has(current.id)) break;
      visited.add(current.id);
      ancestors.unshift(current);
      current = current.replyTo
        ? this.allMessages.find(m => m.id === current.replyTo)
        : null;
    }

    // 원본 메시지의 자식들 수집
    const rootId = ancestors.length > 0 ? ancestors[0].id : messageId;
    const descendants = this.allMessages.filter(
      m => m.replyTo === rootId || visited.has(m.replyTo)
    );

    return [...ancestors, ...descendants]
      .filter((m, i, arr) => arr.findIndex(x => x.id === m.id) === i)
      .sort((a, b) => a.id - b.id);
  }

  /**
   * 읽음 처리
   * @param {string} agentId
   * @param {number[]} [messageIds] - 지정하지 않으면 전체 읽음 처리
   */
  markRead(agentId, messageIds) {
    const inbox = this.inboxes.get(agentId) || [];
    for (const msg of inbox) {
      if (!messageIds || messageIds.includes(msg.id)) {
        msg.read = true;
      }
    }
  }

  /**
   * LLM 프롬프트용 수신함 직렬화
   * @param {string} agentId
   * @param {Object} [options]
   * @param {number} [options.maxChars=2000]
   * @param {MessageType[]} [options.types] - 포함할 타입들
   * @param {boolean} [options.unreadOnly=false]
   * @param {number} [options.limit=20] - 최대 메시지 수
   * @returns {string}
   */
  serializeInbox(agentId, { maxChars = 2000, types, unreadOnly = false, limit = 20 } = {}) {
    let messages = this.getInbox(agentId, { unreadOnly });

    if (types) {
      messages = messages.filter(m => types.includes(m.type));
    }

    // 최신순 정렬 후 limit 적용
    messages = messages
      .sort((a, b) => b.id - a.id)
      .slice(0, limit);

    // 시간순으로 다시 정렬 (직렬화용)
    messages.reverse();

    const parts = [];
    let totalChars = 0;

    for (const msg of messages) {
      const line = `[${msg.from}\u2192${msg.to}] (${msg.type}) ${msg.payload.content || JSON.stringify(msg.payload)}`;

      if (totalChars + line.length > maxChars) break;

      parts.push(line);
      totalChars += line.length;
    }

    return parts.join("\n");
  }

  /**
   * 전체 메시지 로그 (디버깅/GitHub 기록용)
   * @param {Object} [options]
   * @param {MessageType} [options.type]
   * @param {string} [options.taskId]
   * @returns {string} 마크다운 형식
   */
  exportLog({ type, taskId } = {}) {
    let messages = [...this.allMessages];

    if (type) messages = messages.filter(m => m.type === type);
    if (taskId) messages = messages.filter(m => m.payload?.taskId === taskId);

    const lines = ["## 메시지 로그\n"];
    for (const msg of messages) {
      const readStatus = msg.read ? "" : " [NEW]";
      lines.push(
        `- **${msg.from}** -> **${msg.to}** \`${msg.type}\`${readStatus} (${msg.timestamp})`
      );
      if (msg.payload.content) {
        const preview = msg.payload.content.substring(0, 200);
        lines.push(`  > ${preview}${msg.payload.content.length > 200 ? "..." : ""}`);
      }
    }

    return lines.join("\n");
  }
}
