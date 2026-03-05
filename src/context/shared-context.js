// src/context/shared-context.js
// Blackboard 패턴 기반 전역 공유 저장소
// 모든 에이전트가 읽을 수 있는 중앙 저장소로, 쓰기는 author 추적과 함께 수행

/**
 * Blackboard 패턴 기반 전역 공유 저장소
 *
 * 설계 철학:
 * - 모든 에이전트가 읽을 수 있는 중앙 저장소
 * - 쓰기는 author 추적과 함께 수행
 * - 슬롯 기반 구조: 이름으로 접근, 카테고리로 그룹 조회
 * - 변경 이력 자동 기록
 *
 * 슬롯 카탈로그 (16개):
 *   project.requirement  - 원본 요구사항 텍스트
 *   project.title         - 프로젝트 제목
 *   meeting.kickoff.summary   - 킥오프 미팅 최종 정리
 *   meeting.kickoff.keyPoints - 킥오프 핵심 포인트
 *   design.decisions     - 설계 결정사항 본문
 *   design.techStack     - 기술 스택 정보 (구조화)
 *   design.architecture  - 아키텍처 결정 요약
 *   planning.tasks       - 분해된 태스크 목록
 *   planning.taskAssignment - 태스크별 담당자 매핑
 *   code.<taskId>        - 생성된 코드 아티팩트
 *   code.<taskId>.summary - 코드 요약 (토큰 절약용)
 *   review.<taskId>      - 리뷰 결과
 *   review.<taskId>.verdict - "approved" or "changes_requested"
 *   qa.<taskId>          - QA 결과
 *   qa.<taskId>.verdict  - "pass" or "fail"
 *   image.<taskId>       - 이미지 생성 결과 (paths, text)
 */
export class SharedContext {
  constructor() {
    /** @type {Map<string, {value: any, metadata: Object}>} 이름 -> 슬롯 */
    this.slots = new Map();

    /** @type {Array<Object>} 변경 이력 */
    this.history = [];
  }

  /**
   * 슬롯에 값 쓰기
   * @param {string} slotName - 슬롯 이름 (예: "design.decisions")
   * @param {any} value - 저장할 값 (문자열, 객체, 배열 등)
   * @param {Object} metadata
   * @param {string} metadata.author - 작성자 ID (예: "tech_lead", "orchestrator")
   * @param {string} metadata.phase - 작성 Phase (예: "kickoff", "design")
   * @param {string} [metadata.summary] - 값의 요약 (토큰 절약용)
   * @returns {void}
   */
  set(slotName, value, { author, phase, summary = "" }) {
    const previous = this.slots.get(slotName);
    const entry = {
      value,
      metadata: {
        author,
        phase,
        summary,
        updatedAt: new Date().toISOString(),
        version: (previous?.metadata.version || 0) + 1,
      },
    };

    this.slots.set(slotName, entry);

    this.history.push({
      slotName,
      action: previous ? "update" : "create",
      author,
      phase,
      timestamp: entry.metadata.updatedAt,
      version: entry.metadata.version,
    });
  }

  /**
   * 슬롯 값 읽기
   * @param {string} slotName
   * @returns {any|undefined} 값 또는 undefined
   */
  get(slotName) {
    return this.slots.get(slotName)?.value;
  }

  /**
   * 슬롯 메타데이터 포함 읽기
   * @param {string} slotName
   * @returns {{value: any, metadata: Object}|undefined}
   */
  getWithMeta(slotName) {
    return this.slots.get(slotName);
  }

  /**
   * 슬롯 존재 여부
   * @param {string} slotName
   * @returns {boolean}
   */
  has(slotName) {
    return this.slots.has(slotName);
  }

  /**
   * 카테고리 기반 조회
   * 슬롯 이름의 첫 번째 세그먼트를 카테고리로 사용
   * 예: "design.decisions", "design.techStack" -> category "design"
   * @param {string} category
   * @returns {Map<string, {value: any, metadata: Object}>}
   */
  getByCategory(category) {
    const result = new Map();
    for (const [name, slot] of this.slots) {
      if (name.startsWith(category + ".") || name === category) {
        result.set(name, slot);
      }
    }
    return result;
  }

  /**
   * LLM 프롬프트용 직렬화
   * 지정된 슬롯들의 값을 토큰 예산 내에서 직렬화
   * @param {string[]} slotNames - 직렬화할 슬롯 이름 목록 (우선순위 순)
   * @param {Object} options
   * @param {number} [options.maxChars=6000] - 최대 문자 수
   * @param {"markdown"|"compact"} [options.format="markdown"] - 출력 형식
   * @param {boolean} [options.useSummary=false] - 예산 초과 시 summary 사용
   * @returns {string}
   */
  serialize(slotNames, { maxChars = 6000, format = "markdown", useSummary = false } = {}) {
    const parts = [];
    let totalChars = 0;

    for (const name of slotNames) {
      const slot = this.slots.get(name);
      if (!slot) continue;

      let content;
      if (format === "markdown") {
        content = `### ${name}\n${this._valueToString(slot.value)}`;
      } else {
        content = `[${name}] ${this._valueToString(slot.value)}`;
      }

      // 예산 초과 시 summary 사용 시도
      if (totalChars + content.length > maxChars) {
        if (useSummary && slot.metadata.summary) {
          const summaryContent = format === "markdown"
            ? `### ${name} (요약)\n${slot.metadata.summary}`
            : `[${name}:요약] ${slot.metadata.summary}`;

          if (totalChars + summaryContent.length <= maxChars) {
            parts.push(summaryContent);
            totalChars += summaryContent.length;
            continue;
          }
        }
        break; // 예산 소진
      }

      parts.push(content);
      totalChars += content.length;
    }

    return parts.join(format === "markdown" ? "\n\n" : "\n");
  }

  /**
   * 전체 스냅샷 (디버깅/GitHub 기록용)
   * @returns {Object}
   */
  snapshot() {
    const data = {};
    for (const [name, slot] of this.slots) {
      data[name] = {
        value: slot.value,
        ...slot.metadata,
      };
    }
    return {
      timestamp: new Date().toISOString(),
      slotCount: this.slots.size,
      historyCount: this.history.length,
      slots: data,
    };
  }

  /**
   * 값을 문자열로 변환하는 내부 헬퍼
   * @private
   */
  _valueToString(value) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return JSON.stringify(value, null, 2);
    if (typeof value === "object") return JSON.stringify(value, null, 2);
    return String(value);
  }

  /**
   * JSON 직렬화 가능한 객체로 변환 (세션 저장용)
   * @returns {Object}
   */
  toJSON() {
    return {
      slots: Object.fromEntries(
        Array.from(this.slots.entries()).map(([k, v]) => [k, v])
      ),
      history: this.history,
    };
  }

  /**
   * JSON에서 SharedContext 복원
   * @param {Object} data - toJSON()의 반환값
   * @returns {SharedContext}
   */
  static fromJSON(data) {
    const sc = new SharedContext();
    if (data.slots) {
      for (const [name, entry] of Object.entries(data.slots)) {
        sc.slots.set(name, entry);
      }
    }
    if (data.history) {
      sc.history = data.history;
    }
    return sc;
  }
}
