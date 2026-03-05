# SharedContext + Mailbox 하이브리드 아키텍처 구현 계획서

**프로젝트**: Agent Team CLI
**작성일**: 2026-03-06
**버전**: v1.0
**대상**: 에이전트 간 컨텍스트 관리 시스템 전면 개편

---

## 목차

1. [현황 분석](#1-현황-분석)
2. [아키텍처 설계](#2-아키텍처-설계)
3. [수정 영향도](#3-수정-영향도)
4. [구현 순서](#4-구현-순서)
5. [테스트 계획](#5-테스트-계획)
6. [리스크 분석](#6-리스크-분석)

---

## 1. 현황 분석

### 1.1 프로젝트 개요

Agent Team CLI는 5명의 AI 페르소나(김아키/Tech Lead, 이서버/Backend, 박유아이/Frontend, 최배포/DevOps, 정테스트/QA)가 8단계 파이프라인(킥오프 -> 설계 -> 태스크분해 -> 배정 -> 개발 -> 리뷰 -> QA -> PR)을 통해 소프트웨어 개발을 시뮬레이션하는 CLI 도구이다.

각 에이전트는 Claude Code, Gemini CLI, Codex CLI 중 하나에 의해 구동되며, `ModelAdapter`가 서브프로세스 호출을 추상화한다.

### 1.2 현재 아키텍처의 구조적 문제점

#### 문제 A: 비구조적 맥락 전달 (agent.js)

**파일**: `src/agents/agent.js`

| 위치 | 코드 | 문제점 |
|------|------|--------|
| 15행 | `this.conversationHistory = []` | 비구조적 배열. 대화 이력이 `{role, content}` 형태로만 저장되어 누가 누구에게 한 말인지, 어떤 Phase의 발언인지 추적 불가 |
| 47행 | `speak(topic, context, previousDiscussion)` | `previousDiscussion`이 순수 텍스트 문자열. 선택적 참조가 불가능하여 불필요한 발언도 모두 포함됨 |
| 64-67행 | `this.conversationHistory.push(...)` | 히스토리에 추가하지만, 어떤 Phase/회의/태스크에 대한 대화인지 메타데이터 없음. 실제로 이후 로직에서 참조되지도 않음 |
| 80행 | `writeCode(taskDescription, techStack, acceptanceCriteria)` | 세 개의 독립 파라미터를 직접 받음. 설계 결정사항의 맥락이 `techStack` 하나로 축소됨 |
| 110행 | `reviewCode(code, criteria, authorAgent)` | 리뷰에 필요한 설계 맥락, 이전 리뷰 이력, 관련 태스크 정보가 전혀 전달되지 않음 |
| 133행 | `runQA(code, acceptanceCriteria, taskDescription)` | QA에 필요한 기술 스택, 의존성, 이전 QA 결과 등의 맥락 부재 |

**핵심 문제**: 각 메서드가 독립적인 파라미터 목록을 가지며, 공유 컨텍스트 개념이 없다. 새로운 맥락 정보가 필요할 때마다 메서드 시그니처를 변경해야 한다.

#### 문제 B: 토큰 기하급수적 증가 (team.js)

**파일**: `src/agents/team.js`

| 위치 | 코드 | 문제점 |
|------|------|--------|
| 62-65행 | `meetingLog.rounds.flatMap(r => r.speeches).map(s => ...).join("\n\n---\n\n")` | 모든 이전 라운드의 모든 발언을 문자열로 연결. 라운드가 3개이고 에이전트가 5명이면, 3라운드 시작 시 이전 10개 발언(~30,000자)이 각 에이전트에게 전달됨 |
| 87-92행 | `[...meetingLog.rounds.flatMap(r => r.speeches), ...roundLog.speeches].map(...).join(...)` | 최종 정리 시 전체 발언을 다시 한번 연결. 이미 거대한 문자열이 더 커짐 |

**토큰 증가 시뮬레이션** (라운드 3, 에이전트 5명 기준):

```
라운드 1: 각 에이전트가 ~600자 발언
  - 에이전트 1: previousDiscussion = 0자
  - 에이전트 2: previousDiscussion = ~600자 (1명 발언)
  - 에이전트 3: previousDiscussion = ~1,200자 (2명 발언)
  - 에이전트 4: previousDiscussion = ~1,800자
  - 에이전트 5: previousDiscussion = ~2,400자
  - 팀장 정리: ~3,000자

라운드 2: 이전 라운드 전체(~3,000자) + 현재 라운드 누적
  - 에이전트 1: previousDiscussion = ~3,600자
  - 에이전트 2: previousDiscussion = ~4,200자
  - ...
  - 팀장 정리: ~6,600자

라운드 3: 이전 2라운드 전체(~6,600자) + 현재 라운드 누적
  - 에이전트 1: previousDiscussion = ~7,200자
  - ...
  - 팀장 최종 정리 시 allDiscussion = ~12,000자 이상
```

**결론**: 3라운드 회의에서 토큰 사용량이 O(N * R^2) 패턴으로 증가한다 (N=에이전트 수, R=라운드 수). 에이전트당 평균 600자 발언 기준, 최종 정리 프롬프트에만 ~12,000자(~3,000 토큰)가 소비된다.

#### 문제 C: 임의적 정보 절삭 (orchestrator.js)

**파일**: `src/pipeline/orchestrator.js`

| 위치 | 코드 | 문제점 |
|------|------|--------|
| 359행 | `this.state.designDecisions.substring(0, 2000)` | Phase 5(개발)에서 설계 결정사항을 2000자로 절삭. 기술 스택, API 설계, DB 스키마 등 핵심 정보가 잘릴 수 있음 |
| 475행 | `task.generatedCode?.substring(0, 1500)` | Phase 6(리뷰)에서 수정 지시를 위해 코드를 1500자로 절삭. 코드의 후반부(에러 처리, 테스트 등)가 누락됨 |
| 502행 | `this.state.designDecisions.substring(0, 1500)` | Phase 6 수정 루프에서 더 짧은 1500자로 절삭. 같은 설계 결정사항이 Phase에 따라 다른 길이로 전달됨 |
| 625행 | `task.generatedCode?.substring(0, 2000)` | Phase 7(QA)에서 코드를 2000자로 절삭 |
| 656행 | `this.state.designDecisions.substring(0, 1500)` | Phase 7 수정 루프에서 설계 결정사항 절삭 |

**핵심 문제**: `substring()` 하드코딩은 세 가지 심각한 결함을 갖는다:
1. **정보 손실**: 중요한 내용이 뒷부분에 있으면 무조건 잘림
2. **일관성 부재**: 같은 데이터가 2000자, 1500자 등 서로 다른 길이로 절삭됨
3. **지능적 선택 불가**: 우선순위 기반 선택이 아닌 단순 위치 기반 절삭

#### 문제 D: LLM 상태와 시스템 상태의 혼재 (orchestrator.js)

**파일**: `src/pipeline/orchestrator.js`, 17-26행

```javascript
this.state = {
  requirement: "",           // LLM 맥락용
  projectTitle: "",          // LLM 맥락용 + 시스템용
  kickoffIssue: null,        // 시스템용 (GitHub issue number)
  designIssue: null,         // 시스템용
  designDecisions: "",       // LLM 맥락용 (거대한 텍스트)
  tasks: [],                 // LLM 맥락용 + 시스템용
  taskIssues: [],            // 시스템용 (issue numbers, 코드 등)
  completedTasks: [],        // 시스템용
};
```

**문제점**:
- LLM에 전달할 컨텍스트(requirement, designDecisions)와 시스템 메타데이터(kickoffIssue, designIssue)가 하나의 객체에 혼재
- `taskIssues` 배열에 GitHub 메타데이터, 에이전트 할당 정보, 생성된 코드, 리뷰 결과, QA 결과가 모두 뒤섞여 있음
- 특정 Phase에서 필요한 맥락만 추출하는 것이 불가능

#### 문제 E: 에이전트 간 소통 추적 불가

현재 시스템에서는 에이전트 간 직접 소통이 불가능하다:
- 팀장이 개발자에게 수정 지시를 보낼 때 (orchestrator.js 473-476행), `lead.speak()`의 반환값을 직접 `writeCode()`의 파라미터에 넣는 방식
- QA 결과가 개발자에게 전달될 때 (orchestrator.js 618-628행), 마찬가지로 직접 파라미터 전달
- 누가 누구에게 무엇을 말했는지에 대한 기록이 없음 (GitHub 코멘트로만 기록되고, 프로그래밍적으로 참조 불가)

### 1.3 문제 요약

| 문제 | 영향 범위 | 심각도 | 빈도 |
|------|----------|--------|------|
| 비구조적 맥락 전달 | 모든 Phase | 높음 | 모든 LLM 호출 |
| 토큰 기하급수적 증가 | Phase 1, 2 (회의) | 높음 | 회의당 N*R회 |
| 임의적 정보 절삭 | Phase 5, 6, 7 | 높음 | 태스크당 3-9회 |
| LLM/시스템 상태 혼재 | 전체 파이프라인 | 중간 | 상시 |
| 소통 추적 불가 | Phase 6, 7 (수정 루프) | 중간 | 수정 시도마다 |

---

## 2. 아키텍처 설계

### 2.1 설계 원칙

리서치 결과를 바탕으로, 다음 원칙을 적용한다:

1. **Blackboard 패턴**: 전역 공유 저장소에 구조화된 데이터를 저장하고, 모든 에이전트가 읽을 수 있되, 쓰기는 역할 기반으로 제한한다
2. **Mailbox-per-agent 패턴**: 각 에이전트에게 전용 수신함을 부여하여, 타입별/발신자별로 메시지를 관리한다
3. **우선순위 기반 컨텍스트 조립**: 토큰 예산 내에서 필수 -> 작업별 -> 소통 -> 보조 순서로 맥락을 조립한다
4. **출처 추적(Provenance)**: 모든 데이터에 작성자, 작성 시점, Phase 정보를 기록한다
5. **관심사 분리**: LLM 컨텍스트와 시스템 메타데이터를 명확히 분리한다

### 2.2 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                     PipelineOrchestrator                        │
│  (Phase 전환, 에러 처리, GitHub 연동)                           │
│  this.state = { kickoffIssue, designIssue, taskIssues }        │
│  (시스템 메타데이터만 보유)                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐         ┌──────────────────┐              │
│  │  SharedContext    │         │     Mailbox      │              │
│  │  (Blackboard)    │         │  (메시지 큐)      │              │
│  │                  │         │                   │              │
│  │  project.*       │         │  tech_lead.inbox  │              │
│  │  meeting.*       │         │  backend_dev.inbox│              │
│  │  planning.*      │         │  frontend_dev.inbox│             │
│  │  code.*          │         │  devops.inbox     │              │
│  │  review.*        │         │  qa.inbox         │              │
│  │  qa.*            │         │                   │              │
│  └───────┬──────────┘         └───────┬──────────┘              │
│          │                            │                          │
│          └────────────┬───────────────┘                          │
│                       v                                          │
│            ┌──────────────────┐                                  │
│            │  ContextBuilder  │                                  │
│            │  (프롬프트 조립)  │                                  │
│            │                  │                                  │
│            │  우선순위 기반    │                                  │
│            │  토큰 예산 관리  │                                  │
│            │  역할별 맥락 최적│                                  │
│            └───────┬──────────┘                                  │
│                    v                                              │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌───────┐│
│  │김아키   │  │이서버   │  │박유아이 │  │최배포   │  │정테스트││
│  │(Claude) │  │(Gemini) │  │(Gemini) │  │(Codex)  │  │(Codex) ││
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └───────┘│
├─────────────────────────────────────────────────────────────────┤
│                ModelAdapter (변경 없음)                          │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 새 모듈 1: SharedContext (src/context/shared-context.js)

#### 클래스 설계

```javascript
/**
 * Blackboard 패턴 기반 전역 공유 저장소
 *
 * 설계 철학:
 * - 모든 에이전트가 읽을 수 있는 중앙 저장소
 * - 쓰기는 author 추적과 함께 수행
 * - 슬롯 기반 구조: 이름으로 접근, 카테고리로 그룹 조회
 * - 변경 이력 자동 기록
 */
export class SharedContext {
  constructor() {
    /** @type {Map<string, Slot>} 이름 -> 슬롯 */
    this.slots = new Map();

    /** @type {HistoryEntry[]} 변경 이력 */
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
   * @returns {Slot|undefined}
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
   * @returns {Map<string, Slot>}
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
}
```

#### 슬롯 카탈로그

| 슬롯 이름 | 카테고리 | 타입 | 쓰기 주체 | Phase | 설명 |
|-----------|----------|------|-----------|-------|------|
| `project.requirement` | project | string | orchestrator | 초기화 | 원본 요구사항 텍스트 |
| `project.title` | project | string | orchestrator | 초기화 | 프로젝트 제목 |
| `meeting.kickoff.summary` | meeting | string | tech_lead | Phase 1 | 킥오프 미팅 최종 정리 |
| `meeting.kickoff.keyPoints` | meeting | string[] | tech_lead | Phase 1 | 킥오프 핵심 포인트 |
| `design.decisions` | design | string | tech_lead | Phase 2 | 설계 결정사항 본문 |
| `design.techStack` | design | object | tech_lead | Phase 2 | 기술 스택 정보 (구조화) |
| `design.architecture` | design | string | tech_lead | Phase 2 | 아키텍처 결정 요약 |
| `planning.tasks` | planning | object[] | tech_lead | Phase 3 | 분해된 태스크 목록 |
| `planning.taskAssignment` | planning | object | orchestrator | Phase 4 | 태스크별 담당자 매핑 |
| `code.<taskId>` | code | string | 담당 개발자 | Phase 5 | 생성된 코드 아티팩트 |
| `code.<taskId>.summary` | code | string | 담당 개발자 | Phase 5 | 코드 요약 (토큰 절약용) |
| `review.<taskId>` | review | string | tech_lead | Phase 6 | 리뷰 결과 |
| `review.<taskId>.verdict` | review | string | tech_lead | Phase 6 | "approved" or "changes_requested" |
| `qa.<taskId>` | qa | string | qa | Phase 7 | QA 결과 |
| `qa.<taskId>.verdict` | qa | string | qa | Phase 7 | "pass" or "fail" |

### 2.4 새 모듈 2: Mailbox (src/context/mailbox.js)

#### 클래스 설계

```javascript
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
    /** @type {Map<string, Message[]>} agentId -> 수신 메시지 배열 */
    this.inboxes = new Map();

    /** @type {Message[]} 전체 메시지 로그 */
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
   * @returns {Message} 전송된 메시지
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
   * @returns {Message[]} 전송된 메시지들
   */
  broadcast({ from, type, payload, exclude = [] }) {
    const messages = [];
    for (const [agentId, inbox] of this.inboxes) {
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
   * @returns {Message[]}
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
   * @returns {Message[]} 시간순 정렬된 스레드
   */
  getThread(messageId) {
    const thread = [];
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
      const line = `[${msg.from}→${msg.to}] (${msg.type}) ${msg.payload.content || JSON.stringify(msg.payload)}`;

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
```

#### 메시지 타입 정의

```javascript
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
```

### 2.5 새 모듈 3: ContextBuilder (src/context/context-builder.js)

#### 클래스 설계

```javascript
/**
 * 토큰 예산 내 프롬프트 맥락 조립기
 *
 * 설계 철학:
 * - SharedContext + Mailbox에서 특정 작업에 필요한 맥락을 우선순위 기반으로 조립
 * - maxChars 예산을 초과하지 않도록 제어
 * - 각 작업 유형(회의, 코딩, 리뷰, QA, 수정)별 최적화된 조립 전략
 * - summary 폴백: 예산 부족 시 요약 버전 사용
 */
export class ContextBuilder {
  /**
   * @param {SharedContext} sharedContext
   * @param {Mailbox} mailbox
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
      const techSection = `## 기술 스택\n${this.shared.constructor.prototype._valueToString.call(this.shared, techStack)}`;
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
```

#### 토큰 예산 조립 전략 시각화

```
┌───────────────────────────────────────────────────┐
│               총 예산: 6000자 (~1500 토큰)          │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │ 1. 필수 (project.*)           ~500자  [고정] │  │
│  ├──────────────────────────────────────────────┤  │
│  │ 2. 작업별 필수 (태스크/코드)    ~2000자 [가변]│  │
│  ├──────────────────────────────────────────────┤  │
│  │ 3. 소통 맥락 (inbox 메시지)    ~2000자 [가변]│  │
│  ├──────────────────────────────────────────────┤  │
│  │ 4. 보조 참조 (설계/요약)       ~1500자 [잔여]│  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
│  * 상위 계층이 예산을 초과하면 하위 계층이 축소됨     │
│  * summary 폴백: 원본 대신 요약 사용으로 절약        │
│  * 최소 보장: 필수 계층은 항상 포함                   │
└───────────────────────────────────────────────────┘
```

---

## 3. 수정 영향도

### 3.1 agent.js 수정 (src/agents/agent.js)

#### 변경 범위: 중간-높음

**핵심 변경**: 모든 public 메서드의 시그니처 변경, conversationHistory 제거

##### Before -> After 비교

**생성자:**
```javascript
// BEFORE
constructor(personaConfig, modelAdapter) {
  // ...
  this.conversationHistory = [];  // 제거 대상
}

// AFTER
constructor(personaConfig, modelAdapter) {
  // ...
  // conversationHistory 제거됨 - Mailbox가 대화 이력 관리
}
```

**speak() 메서드:**
```javascript
// BEFORE (47-75행)
async speak(topic, context = "", previousDiscussion = "") {
  const systemPrompt = this._buildSystemPrompt(context);
  let userMessage = `## 현재 논의 주제\n${topic}`;
  if (previousDiscussion) {
    userMessage += `\n\n## 이전 논의 내용\n${previousDiscussion}`;
    // ...
  }
  // conversationHistory.push(...)
  return { agent, role, model, content };
}

// AFTER
async speak(topic, contextBundle) {
  // contextBundle = ContextBuilder.buildForMeeting()의 반환값
  const systemPrompt = this._buildSystemPrompt(contextBundle.context);
  let userMessage = `## 현재 논의 주제\n${topic}`;
  if (contextBundle.previousDiscussion) {
    userMessage += `\n\n## 이전 논의\n${contextBundle.previousDiscussion}`;
    userMessage += `\n\n${this.name}(${this.role})로서 의견을 제시해주세요.`;
  } else {
    userMessage += `\n\n${this.name}(${this.role})로서 이 주제에 대한 의견을 제시해주세요.`;
  }
  const response = await this.adapter.chat(this.modelKey, systemPrompt, userMessage);
  // conversationHistory 제거 - Mailbox에서 관리
  return { agent: this.name, role: this.role, model: this.modelKey, content: response };
}
```

**writeCode() 메서드:**
```javascript
// BEFORE (80-105행)
async writeCode(taskDescription, techStack, acceptanceCriteria) {
  const systemPrompt = this._buildSystemPrompt(`현재 작업 중인 기술 스택: ${techStack}`);
  const prompt = `## 개발 태스크\n${taskDescription}\n\n## 수용 기준\n${acceptanceCriteria}...`;
  // ...
}

// AFTER
async writeCode(contextBundle) {
  // contextBundle = ContextBuilder.buildForCoding() 또는 buildForFix()의 반환값
  const systemPrompt = this._buildSystemPrompt(contextBundle.systemContext);
  const prompt = `## 개발 태스크\n${contextBundle.taskDescription}\n\n## 수용 기준\n${contextBundle.acceptanceCriteria}\n\n위 태스크를 구현해주세요. ${this.name}(${this.role})의 코딩 스타일과 전문성을 반영하여 작성합니다.`;
  const response = await this.adapter.generateCode(this.modelKey, systemPrompt, prompt);
  return { agent: this.name, role: this.role, model: this.modelKey, code: response };
}
```

**reviewCode() 메서드:**
```javascript
// BEFORE (110-128행)
async reviewCode(code, criteria, authorAgent) {
  const systemPrompt = this._buildSystemPrompt(`${authorAgent}가 작성한 코드를 리뷰합니다.`);
  // ...
}

// AFTER
async reviewCode(contextBundle, authorAgent) {
  // contextBundle = ContextBuilder.buildForReview()의 반환값
  const systemPrompt = this._buildSystemPrompt(
    `${authorAgent}가 작성한 코드를 리뷰합니다.\n\n${contextBundle.systemContext}`
  );
  const response = await this.adapter.reviewCode(
    this.modelKey, systemPrompt, contextBundle.code, contextBundle.criteria
  );
  return { agent: this.name, role: this.role, model: this.modelKey, review: response };
}
```

**runQA() 메서드:**
```javascript
// BEFORE (133-169행)
async runQA(code, acceptanceCriteria, taskDescription) { ... }

// AFTER
async runQA(contextBundle) {
  // contextBundle = ContextBuilder.buildForQA()의 반환값
  const systemPrompt = this._buildSystemPrompt(
    `QA 엔지니어로서 코드의 품질과 수용 기준 충족 여부를 검증합니다.\n\n${contextBundle.systemContext}`
  );
  const prompt = `## 검증 대상 코드\n\`\`\`\n${contextBundle.code}\n\`\`\`\n\n## 태스크 설명\n${contextBundle.taskDescription}\n\n## 수용 기준\n${contextBundle.criteria}\n\n위 코드에 대해 QA 검증을 수행해주세요...`;
  // ...
}
```

**breakdownTasks() 메서드:**
```javascript
// BEFORE (174-223행)
async breakdownTasks(designDecisions, requirement) { ... }

// AFTER
async breakdownTasks(contextBundle) {
  // contextBundle = { designDecisions, requirement } from SharedContext
  const systemPrompt = this._buildSystemPrompt(
    "프로젝트의 기술 설계가 완료되었습니다. 이를 실행 가능한 태스크로 분해합니다."
  );
  const prompt = `## 프로젝트 요구사항\n${contextBundle.requirement}\n\n## 기술 설계 결정사항\n${contextBundle.designDecisions}\n\n위 내용을 기반으로 태스크를 분해해주세요...`;
  // ...
}
```

**제거 대상:**
```javascript
// 제거: resetHistory() (228-230행)
// conversationHistory가 없으므로 불필요
```

#### 영향받는 호출처

| 호출처 | 파일 | 행 | 변경 필요 |
|--------|------|-----|----------|
| `agent.speak()` | team.js | 77행 | 시그니처 변경 |
| `this.lead.speak()` | team.js | 94행 | 시그니처 변경 |
| `agent.writeCode()` | orchestrator.js | 357-361행 | 시그니처 변경 |
| `lead.reviewCode()` | orchestrator.js | 425-429행 | 시그니처 변경 |
| `agent.writeCode()` (수정) | orchestrator.js | 489-504행 | 시그니처 변경 |
| `lead.speak()` (수정 지시) | orchestrator.js | 473-476행 | 시그니처 변경 |
| `qaAgent.runQA()` | orchestrator.js | 553-557행 | 시그니처 변경 |
| `lead.speak()` (QA 분석) | orchestrator.js | 618-628행 | 시그니처 변경 |
| `agent.writeCode()` (QA 수정) | orchestrator.js | 643-657행 | 시그니처 변경 |
| `team.lead.breakdownTasks()` | orchestrator.js | 229-232행 | 시그니처 변경 |

### 3.2 team.js 수정 (src/agents/team.js)

#### 변경 범위: 높음

**핵심 변경**: SharedContext/Mailbox 주입, conductMeeting() 전면 리팩터링

##### Before -> After 비교

**생성자:**
```javascript
// BEFORE
constructor(config, modelAdapter) {
  this.config = config;
  this.adapter = modelAdapter;
  this.agents = {};
  this._initAgents();
}

// AFTER
constructor(config, modelAdapter, { sharedContext, mailbox, contextBuilder }) {
  this.config = config;
  this.adapter = modelAdapter;
  this.shared = sharedContext;
  this.mailbox = mailbox;
  this.contextBuilder = contextBuilder;
  this.agents = {};
  this._initAgents();
  // Mailbox에 에이전트 등록
  this.mailbox.registerAgents(Object.keys(this.agents));
}
```

**conductMeeting() 핵심 변경:**
```javascript
// BEFORE: previousDiscussion 문자열 연결 (62-65행)
const previousDiscussion = meetingLog.rounds
  .flatMap(r => r.speeches)
  .map(s => `**${s.agent} (${s.role})**: ${s.content}`)
  .join("\n\n---\n\n");

// AFTER: ContextBuilder가 토큰 예산 내 맥락 조립
for (const agent of speakOrder) {
  const contextBundle = this.contextBuilder.buildForMeeting(agent.id, topic);
  const speech = await agent.speak(topic, contextBundle);

  // Mailbox에 발언 기록 (broadcast)
  this.mailbox.broadcast({
    from: agent.id,
    type: "meeting_speech",
    payload: { content: speech.content, round: round + 1 },
  });

  roundLog.speeches.push(speech);
}
```

**formatMeetingAsMarkdown() 변경:**
```javascript
// BEFORE: meetingLog.rounds 기반
// AFTER: Mailbox의 meeting_speech 메시지에서도 생성 가능하나,
//        기존 meetingLog 구조를 유지하여 호환성 확보
// 이 메서드는 최소한의 변경만 적용
```

### 3.3 orchestrator.js 수정 (src/pipeline/orchestrator.js)

#### 변경 범위: 높음 (가장 많은 변경)

**핵심 변경**: this.state를 SharedContext로 대체, 모든 substring() 제거

##### this.state 축소

```javascript
// BEFORE (17-26행)
this.state = {
  requirement: "",
  projectTitle: "",
  kickoffIssue: null,
  designIssue: null,
  designDecisions: "",
  tasks: [],
  taskIssues: [],
  completedTasks: [],
};

// AFTER
this.state = {
  // 시스템 메타데이터만 보유 (GitHub issue numbers 등)
  kickoffIssue: null,
  designIssue: null,
  taskIssues: [],        // { issueNumber, nodeId, taskId, assignedAgentId }
  completedTasks: [],    // { taskId, issueNumber, reviewApproved, qaPassed, qaAttempts }
};
// LLM 맥락은 this.shared (SharedContext)에서 관리
```

##### 생성자 변경

```javascript
// BEFORE
constructor(team, github, config, interactionMode) { ... }

// AFTER
constructor(team, github, config, interactionMode, { sharedContext, mailbox, contextBuilder }) {
  this.team = team;
  this.github = github;
  this.config = config;
  this.shared = sharedContext;
  this.mailbox = mailbox;
  this.contextBuilder = contextBuilder;
  this.interaction = new InteractionManager(interactionMode, { ... });
  this.state = {
    kickoffIssue: null,
    designIssue: null,
    taskIssues: [],
    completedTasks: [],
  };
}
```

##### Phase별 변경 요약

**Phase 1 (kickoff):**
```javascript
// BEFORE: meetingLog만 반환
// AFTER: SharedContext에 킥오프 요약 저장
async phaseKickoff() {
  // ... 회의 진행 ...

  // SharedContext에 저장
  const summary = lastRound.speeches.find(s => s.isSummary);
  this.shared.set("meeting.kickoff.summary", summary?.content || "", {
    author: "tech_lead",
    phase: "kickoff",
    summary: summary?.content?.substring(0, 300) || "",
  });
}
```

**Phase 2 (design):**
```javascript
// BEFORE: this.state.designDecisions = summary?.content || markdown;
// AFTER: SharedContext에 구조화 저장
this.shared.set("design.decisions", summary?.content || markdown, {
  author: "tech_lead",
  phase: "design",
  summary: "설계 결정사항 (요약은 자동 생성)",
});
```

**Phase 3 (taskBreakdown):**
```javascript
// BEFORE: this.state.tasks = tasks;
// AFTER: SharedContext에 저장, 각 태스크에 ID 부여
for (let i = 0; i < tasks.length; i++) {
  tasks[i].id = `task-${i + 1}`;
}
this.shared.set("planning.tasks", tasks, {
  author: "tech_lead",
  phase: "taskBreakdown",
  summary: `${tasks.length}개 태스크`,
});
```

**Phase 5 (development) - substring() 제거:**
```javascript
// BEFORE (357-361행)
const result = await agent.writeCode(
  task.description,
  this.state.designDecisions.substring(0, 2000),  // 제거 대상
  task.acceptance_criteria?.join("\n") || ""
);

// AFTER
const contextBundle = this.contextBuilder.buildForCoding(agent.id, task.taskId);
const result = await agent.writeCode(contextBundle);

// 코드를 SharedContext에 저장
this.shared.set(`code.${task.taskId}`, result.code, {
  author: agent.id,
  phase: "development",
  summary: `${task.title} 구현 코드`,
});
```

**Phase 6 (codeReview) - substring() 제거 및 Mailbox 사용:**
```javascript
// BEFORE (473-476행)
const fixGuidance = await lead.speak(
  `...리뷰 내용:\n${result.review}`,
  `원본 코드:\n${task.generatedCode?.substring(0, 1500)}`  // 제거 대상
);

// AFTER
const reviewBundle = this.contextBuilder.buildForReview("tech_lead", task.taskId);
const result = await lead.reviewCode(reviewBundle, task.assignedAgentId);

// Mailbox에 리뷰 피드백 전송
this.mailbox.send({
  from: "tech_lead",
  to: task.assignedAgentId,
  type: "review_feedback",
  payload: { content: result.review, taskId: task.taskId, verdict: needsFix ? "changes_requested" : "approved" },
});

// 수정 지시 전송
this.mailbox.send({
  from: "tech_lead",
  to: task.assignedAgentId,
  type: "fix_guidance",
  payload: { content: fixGuidance.content, taskId: task.taskId },
});

// 개발자 수정
const fixBundle = this.contextBuilder.buildForFix(task.assignedAgentId, task.taskId, "review");
const fixResult = await task.assignedAgent?.writeCode(fixBundle);
```

**Phase 7 (QA) - 동일 패턴 적용:**
```javascript
// BEFORE (625행)
// ${task.generatedCode?.substring(0, 2000)}  // 제거 대상
// BEFORE (656행)
// this.state.designDecisions.substring(0, 1500)  // 제거 대상

// AFTER: ContextBuilder가 모든 맥락 조립을 관리
const qaBundle = this.contextBuilder.buildForQA("qa", task.taskId);
const result = await qaAgent.runQA(qaBundle);

this.shared.set(`qa.${task.taskId}`, result.qaResult, {
  author: "qa",
  phase: "qa",
  summary: passed ? "PASS" : "FAIL",
});
```

### 3.4 index.js 수정 (src/index.js)

#### 변경 범위: 낮음 (배선만 변경)

```javascript
// BEFORE (95-116행)
const adapter = new ModelAdapter(config);
const team = new Team(config, adapter);
const github = new GitHubClient(...);
const orchestrator = new PipelineOrchestrator(team, github, config, interactionMode);

// AFTER
import { SharedContext } from "./context/shared-context.js";
import { Mailbox } from "./context/mailbox.js";
import { ContextBuilder } from "./context/context-builder.js";

const adapter = new ModelAdapter(config);
const sharedContext = new SharedContext();
const mailbox = new Mailbox();
const contextBuilder = new ContextBuilder(sharedContext, mailbox, {
  maxChars: config.pipeline?.max_context_chars || 6000,
});

const contextDeps = { sharedContext, mailbox, contextBuilder };
const team = new Team(config, adapter, contextDeps);
const github = new GitHubClient(...);

// SharedContext 초기화
sharedContext.set("project.requirement", requirement, {
  author: "orchestrator",
  phase: "init",
  summary: requirement.substring(0, 200),
});
sharedContext.set("project.title", title, {
  author: "orchestrator",
  phase: "init",
});

const orchestrator = new PipelineOrchestrator(
  team, github, config, interactionMode, contextDeps
);
await orchestrator.run(requirement, title);
```

**meeting 커맨드도 동일 패턴:**
```javascript
// meeting 커맨드 (128-162행)
const adapter = new ModelAdapter(config);
const sharedContext = new SharedContext();
const mailbox = new Mailbox();
const contextBuilder = new ContextBuilder(sharedContext, mailbox);
const contextDeps = { sharedContext, mailbox, contextBuilder };
const team = new Team(config, adapter, contextDeps);

sharedContext.set("project.requirement", topic, { author: "orchestrator", phase: "init" });

const meetingLog = await team.conductMeeting(topic, "", { ... });
```

### 3.5 변경하지 않는 파일

| 파일 | 이유 |
|------|------|
| `src/models/adapter.js` | AI 모델 호출 인터페이스 - SharedContext와 무관 |
| `src/config/loader.js` | 설정 파일 로딩 - 변경 불필요 |
| `src/config/interaction.js` | 사용자 인터랙션 관리 - 변경 불필요 |
| `src/github/client.js` | GitHub API 클라이언트 - 변경 불필요 |
| `agent-team.config.yaml` | 설정 스키마 - `max_context_chars` 옵션 추가 가능하나 선택적 |
| `templates/` | 템플릿 디렉토리 - 변경 불필요 |

---

## 4. 구현 순서

### 4.1 의존성 그래프

```
Phase 1: SharedContext (독립)
Phase 2: Mailbox (독립)
          ↓                ↓
Phase 3: ContextBuilder (SharedContext + Mailbox 의존)
          ↓
Phase 4: Agent 리팩터링 (ContextBuilder의 반환 타입 의존)
          ↓
Phase 5: Team 리팩터링 (Agent + SharedContext + Mailbox + ContextBuilder)
          ↓
Phase 6: Orchestrator 리팩터링 (모든 모듈)
          ↓
Phase 7: index.js 배선 변경 (모든 모듈)
          ↓
Phase 8: 통합 검증
```

### 4.2 단계별 작업 계획

#### Step 1: SharedContext 구현 (예상: 2시간)

**작업 내용:**
1. `src/context/` 디렉토리 생성
2. `src/context/shared-context.js` 작성
3. `src/context/__tests__/shared-context.test.js` 유닛 테스트 작성

**완료 기준:**
- `set()`, `get()`, `getWithMeta()`, `has()` 기본 CRUD 동작
- `getByCategory()` 카테고리 필터링 정확성
- `serialize()` 토큰 예산 내 직렬화 (maxChars 초과 방지)
- `snapshot()` 전체 상태 직렬화
- 변경 이력(history) 자동 기록
- `useSummary` 폴백 동작

**테스트 실행:**
```bash
node --test src/context/__tests__/shared-context.test.js
```

#### Step 2: Mailbox 구현 (예상: 2시간)

**작업 내용:**
1. `src/context/mailbox.js` 작성
2. `src/context/__tests__/mailbox.test.js` 유닛 테스트 작성

**완료 기준:**
- `registerAgents()` 수신함 초기화
- `send()` 1:1 메시지 전송 및 수신함 추가
- `broadcast()` 전체 브로드캐스트 (자기 자신 제외)
- `getInbox()` 필터링 (type, unreadOnly, since, from)
- `getThread()` 스레드 추적 (replyTo 체인)
- `markRead()` 읽음 처리
- `serializeInbox()` 토큰 예산 내 직렬화
- `exportLog()` 마크다운 로그 생성
- 메시지 ID 순차 증가

**테스트 실행:**
```bash
node --test src/context/__tests__/mailbox.test.js
```

#### Step 3: ContextBuilder 구현 (예상: 3시간)

**의존성:** Step 1 (SharedContext) + Step 2 (Mailbox)

**작업 내용:**
1. `src/context/context-builder.js` 작성
2. `src/context/__tests__/context-builder.test.js` 유닛 테스트 작성

**완료 기준:**
- `buildForMeeting()`: 회의 맥락 조립, maxChars 미초과, 필수 슬롯 포함
- `buildForCoding()`: 코딩 맥락 조립, 설계 결정 + 수정 지시 포함
- `buildForReview()`: 리뷰 맥락 조립, 코드 + 기준 + 태스크 설명
- `buildForQA()`: QA 맥락 조립, 코드 + 이전 리뷰 결과
- `buildForFix()`: 수정 맥락 조립, 피드백 + 수정 지시 우선
- 모든 메서드의 반환값이 maxChars를 초과하지 않음
- summary 폴백이 작동함

**테스트 실행:**
```bash
node --test src/context/__tests__/context-builder.test.js
```

#### Step 4: Agent 리팩터링 (예상: 1.5시간)

**의존성:** Step 3 (ContextBuilder의 반환 타입)

**작업 내용:**
1. `src/agents/agent.js` 수정
   - `conversationHistory` 제거
   - `speak()` 시그니처 변경: `(topic, contextBundle)`
   - `writeCode()` 시그니처 변경: `(contextBundle)`
   - `reviewCode()` 시그니처 변경: `(contextBundle, authorAgent)`
   - `runQA()` 시그니처 변경: `(contextBundle)`
   - `breakdownTasks()` 시그니처 변경: `(contextBundle)`
   - `resetHistory()` 제거

**완료 기준:**
- 모든 메서드가 contextBundle을 받아 처리
- 반환값 구조는 기존과 동일 (하위 호환)
- `_buildSystemPrompt()` 변경 없음

#### Step 5: Team 리팩터링 (예상: 2시간)

**의존성:** Step 4 (Agent)

**작업 내용:**
1. `src/agents/team.js` 수정
   - 생성자에 `{ sharedContext, mailbox, contextBuilder }` 파라미터 추가
   - `conductMeeting()` 리팩터링
     - previousDiscussion 문자열 연결 제거
     - ContextBuilder로 맥락 조립
     - Mailbox에 발언 기록
   - `formatMeetingAsMarkdown()` 최소 변경 (meetingLog 구조 유지)

**완료 기준:**
- `conductMeeting()`이 Mailbox 기반으로 동작
- 회의 결과가 기존과 동일한 meetingLog 구조 반환
- 각 에이전트가 이전 발언을 Mailbox에서 참조

#### Step 6: Orchestrator 리팩터링 (예상: 4시간)

**의존성:** Step 5 (Team)

**작업 내용:**
1. `src/pipeline/orchestrator.js` 수정
   - 생성자에 `{ sharedContext, mailbox, contextBuilder }` 파라미터 추가
   - `this.state` 축소 (시스템 메타데이터만)
   - Phase 1-8 전부 SharedContext + Mailbox + ContextBuilder 사용으로 변경
   - 모든 `substring()` 하드코딩 제거
   - 태스크에 `taskId` 부여 로직 추가

**완료 기준:**
- `this.state.designDecisions` 참조 완전 제거
- `this.state.requirement` 참조 완전 제거 -> `this.shared.get("project.requirement")`
- 모든 `substring()` 제거
- Phase 간 데이터 전달이 SharedContext를 통해 이루어짐
- 수정 루프(Review/QA)에서 Mailbox 메시지 체인 사용

#### Step 7: index.js 배선 변경 (예상: 1시간)

**의존성:** Step 6 (Orchestrator)

**작업 내용:**
1. `src/index.js` 수정
   - `import` 추가 (SharedContext, Mailbox, ContextBuilder)
   - `run` 커맨드: 세 모듈 인스턴스 생성, Team/Orchestrator에 주입
   - `meeting` 커맨드: 동일 패턴
   - SharedContext 초기화 (project.requirement, project.title)

**완료 기준:**
- `run` 커맨드가 정상 실행
- `meeting` 커맨드가 정상 실행
- `test-models` 커맨드는 변경 없이 동작

#### Step 8: 통합 검증 (예상: 2시간)

**작업 내용:**
1. 전체 유닛 테스트 실행
2. `test-models` 커맨드 동작 확인
3. `meeting kickoff` 커맨드 통합 테스트
4. `run` 커맨드 통합 테스트 (API 키 필요)
5. SharedContext 스냅샷 확인
6. Mailbox 로그 확인

### 4.3 총 예상 시간: ~17.5시간

| Step | 작업 | 예상 시간 | 난이도 |
|------|------|----------|--------|
| 1 | SharedContext | 2h | 낮음 |
| 2 | Mailbox | 2h | 낮음 |
| 3 | ContextBuilder | 3h | 중간 |
| 4 | Agent 리팩터링 | 1.5h | 중간 |
| 5 | Team 리팩터링 | 2h | 중간-높음 |
| 6 | Orchestrator 리팩터링 | 4h | 높음 |
| 7 | index.js 배선 | 1h | 낮음 |
| 8 | 통합 검증 | 2h | 중간 |

---

## 5. 테스트 계획

### 5.1 테스트 프레임워크

Node.js 내장 test runner (`node:test`)를 사용한다. 추가 의존성이 불필요하며, `package.json`에 다음 스크립트를 추가한다:

```json
{
  "scripts": {
    "test": "node --test src/context/__tests__/*.test.js",
    "test:unit": "node --test src/context/__tests__/*.test.js",
    "test:shared": "node --test src/context/__tests__/shared-context.test.js",
    "test:mailbox": "node --test src/context/__tests__/mailbox.test.js",
    "test:builder": "node --test src/context/__tests__/context-builder.test.js"
  }
}
```

### 5.2 유닛 테스트: SharedContext

```javascript
// src/context/__tests__/shared-context.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SharedContext } from "../shared-context.js";

describe("SharedContext", () => {
  describe("set/get", () => {
    it("슬롯에 값을 저장하고 읽을 수 있다", () => { /* ... */ });
    it("존재하지 않는 슬롯은 undefined를 반환한다", () => { /* ... */ });
    it("같은 슬롯에 덮어쓰기하면 최신 값이 반환된다", () => { /* ... */ });
    it("메타데이터(author, phase, version)가 정확히 기록된다", () => { /* ... */ });
    it("version이 업데이트마다 증가한다", () => { /* ... */ });
  });

  describe("getByCategory", () => {
    it("카테고리가 일치하는 슬롯만 반환한다", () => { /* ... */ });
    it("빈 카테고리는 빈 Map을 반환한다", () => { /* ... */ });
    it("단일 세그먼트 이름(category 자체)도 매칭한다", () => { /* ... */ });
  });

  describe("serialize", () => {
    it("지정된 슬롯들을 순서대로 직렬화한다", () => { /* ... */ });
    it("maxChars를 초과하지 않는다", () => {
      const ctx = new SharedContext();
      ctx.set("slot1", "a".repeat(3000), { author: "test", phase: "test" });
      ctx.set("slot2", "b".repeat(3000), { author: "test", phase: "test" });
      const result = ctx.serialize(["slot1", "slot2"], { maxChars: 4000 });
      assert.ok(result.length <= 4000);
    });
    it("useSummary=true일 때 예산 초과 시 summary를 사용한다", () => { /* ... */ });
    it("존재하지 않는 슬롯은 건너뛴다", () => { /* ... */ });
    it("compact 형식이 올바르게 작동한다", () => { /* ... */ });
  });

  describe("history", () => {
    it("set 호출 시 history에 기록된다", () => { /* ... */ });
    it("create와 update 액션이 구분된다", () => { /* ... */ });
  });

  describe("snapshot", () => {
    it("전체 상태를 직렬화한다", () => { /* ... */ });
    it("슬롯 수와 히스토리 수가 정확하다", () => { /* ... */ });
  });
});
```

### 5.3 유닛 테스트: Mailbox

```javascript
// src/context/__tests__/mailbox.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Mailbox } from "../mailbox.js";

describe("Mailbox", () => {
  describe("registerAgents", () => {
    it("에이전트 수신함이 초기화된다", () => { /* ... */ });
    it("중복 등록 시 기존 메시지가 보존된다", () => { /* ... */ });
  });

  describe("send", () => {
    it("메시지가 수신자의 inbox에 추가된다", () => { /* ... */ });
    it("메시지 ID가 순차 증가한다", () => { /* ... */ });
    it("메시지가 allMessages에 기록된다", () => { /* ... */ });
    it("replyTo가 정확히 설정된다", () => { /* ... */ });
    it("등록되지 않은 수신자에게 보내면 allMessages에만 기록된다", () => { /* ... */ });
  });

  describe("broadcast", () => {
    it("발신자를 제외한 모든 에이전트에게 전송된다", () => {
      const mb = new Mailbox();
      mb.registerAgents(["a", "b", "c"]);
      const msgs = mb.broadcast({ from: "a", type: "meeting_speech", payload: { content: "hi" } });
      assert.equal(msgs.length, 2); // b, c에게만
    });
    it("exclude 목록의 에이전트가 제외된다", () => { /* ... */ });
  });

  describe("getInbox", () => {
    it("type 필터가 작동한다", () => { /* ... */ });
    it("unreadOnly 필터가 작동한다", () => { /* ... */ });
    it("from 필터가 작동한다", () => { /* ... */ });
    it("since 필터가 작동한다", () => { /* ... */ });
    it("복합 필터가 작동한다", () => { /* ... */ });
  });

  describe("getThread", () => {
    it("replyTo 체인을 추적하여 전체 스레드를 반환한다", () => { /* ... */ });
    it("존재하지 않는 메시지 ID는 빈 배열을 반환한다", () => { /* ... */ });
  });

  describe("markRead", () => {
    it("지정된 메시지가 읽음 처리된다", () => { /* ... */ });
    it("messageIds 생략 시 전체 읽음 처리", () => { /* ... */ });
  });

  describe("serializeInbox", () => {
    it("maxChars를 초과하지 않는다", () => { /* ... */ });
    it("types 필터가 작동한다", () => { /* ... */ });
    it("최신 메시지부터 포함하되 시간순으로 출력한다", () => { /* ... */ });
    it("limit가 적용된다", () => { /* ... */ });
  });

  describe("exportLog", () => {
    it("마크다운 형식으로 전체 로그를 생성한다", () => { /* ... */ });
    it("type 필터가 작동한다", () => { /* ... */ });
    it("taskId 필터가 작동한다", () => { /* ... */ });
  });
});
```

### 5.4 유닛 테스트: ContextBuilder

```javascript
// src/context/__tests__/context-builder.test.js
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { SharedContext } from "../shared-context.js";
import { Mailbox } from "../mailbox.js";
import { ContextBuilder } from "../context-builder.js";

describe("ContextBuilder", () => {
  let shared, mailbox, builder;

  beforeEach(() => {
    shared = new SharedContext();
    mailbox = new Mailbox();
    builder = new ContextBuilder(shared, mailbox, { maxChars: 6000 });

    // 기본 테스트 데이터
    shared.set("project.requirement", "TODO API 구현", { author: "orch", phase: "init" });
    shared.set("project.title", "TODO App", { author: "orch", phase: "init" });
    shared.set("design.decisions", "Express + PostgreSQL + React", {
      author: "tech_lead", phase: "design",
      summary: "Express, PostgreSQL, React 기반",
    });
    shared.set("planning.tasks", [
      { id: "task-1", title: "API 구현", description: "REST API",
        acceptance_criteria: ["CRUD 엔드포인트", "입력 검증"], suitable_role: "backend_dev" },
    ], { author: "tech_lead", phase: "taskBreakdown" });

    mailbox.registerAgents(["tech_lead", "backend_dev", "frontend_dev", "devops", "qa"]);
  });

  describe("buildForMeeting", () => {
    it("필수 프로젝트 정보가 포함된다", () => {
      const result = builder.buildForMeeting("backend_dev", "기술 스택 논의");
      assert.ok(result.context.includes("TODO App"));
      assert.ok(result.context.includes("TODO API 구현"));
    });

    it("maxChars를 초과하지 않는다", () => {
      // 대량의 이전 발언 추가
      for (let i = 0; i < 20; i++) {
        mailbox.send({
          from: "tech_lead", to: "backend_dev", type: "meeting_speech",
          payload: { content: "발언 ".repeat(200), round: 1 },
        });
      }
      const result = builder.buildForMeeting("backend_dev", "test");
      assert.ok(result.context.length <= 6000);
    });

    it("이전 회의 발언이 포함된다", () => {
      mailbox.send({
        from: "tech_lead", to: "backend_dev", type: "meeting_speech",
        payload: { content: "Node.js를 추천합니다", round: 1 },
      });
      const result = builder.buildForMeeting("backend_dev", "test");
      assert.ok(result.context.includes("Node.js를 추천합니다"));
    });
  });

  describe("buildForCoding", () => {
    it("태스크 정보가 반환된다", () => {
      const result = builder.buildForCoding("backend_dev", "task-1");
      assert.equal(result.taskDescription, "REST API");
      assert.ok(result.acceptanceCriteria.includes("CRUD 엔드포인트"));
    });

    it("설계 결정사항이 포함된다", () => {
      const result = builder.buildForCoding("backend_dev", "task-1");
      assert.ok(
        result.systemContext.includes("Express") ||
        result.systemContext.includes("설계")
      );
    });

    it("수정 지시가 있으면 포함된다", () => {
      mailbox.send({
        from: "tech_lead", to: "backend_dev", type: "fix_guidance",
        payload: { content: "에러 처리를 추가하세요", taskId: "task-1" },
      });
      const result = builder.buildForCoding("backend_dev", "task-1");
      assert.ok(result.systemContext.includes("에러 처리를 추가하세요"));
    });
  });

  describe("buildForReview", () => {
    it("코드와 기준이 반환된다", () => {
      shared.set("code.task-1", "function hello() {}", { author: "backend_dev", phase: "dev" });
      const result = builder.buildForReview("tech_lead", "task-1");
      assert.equal(result.code, "function hello() {}");
      assert.ok(result.criteria.includes("CRUD 엔드포인트"));
    });
  });

  describe("buildForQA", () => {
    it("코드, 기준, 태스크 설명이 반환된다", () => {
      shared.set("code.task-1", "const api = ...", { author: "backend_dev", phase: "dev" });
      const result = builder.buildForQA("qa", "task-1");
      assert.equal(result.code, "const api = ...");
      assert.equal(result.taskDescription, "REST API");
    });
  });

  describe("buildForFix", () => {
    it("피드백과 수정 지시가 최우선 포함된다", () => {
      shared.set("code.task-1", "old code", { author: "backend_dev", phase: "dev" });
      shared.set("review.task-1", "에러 처리 부족", { author: "tech_lead", phase: "review" });
      mailbox.send({
        from: "tech_lead", to: "backend_dev", type: "fix_guidance",
        payload: { content: "try-catch 추가할 것", taskId: "task-1" },
      });
      const result = builder.buildForFix("backend_dev", "task-1", "review");
      assert.ok(result.systemContext.includes("에러 처리 부족"));
      assert.ok(result.systemContext.includes("try-catch 추가할 것"));
      assert.equal(result.currentCode, "old code");
    });
  });
});
```

### 5.5 통합 테스트 시나리오

#### 시나리오 1: 회의 흐름 통합 테스트

**목적**: Team.conductMeeting()이 SharedContext + Mailbox 기반으로 정상 동작하는지 검증

**전제 조건**: 모델 어댑터를 Mock으로 대체

```javascript
// src/__tests__/integration/meeting-flow.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SharedContext } from "../../context/shared-context.js";
import { Mailbox } from "../../context/mailbox.js";
import { ContextBuilder } from "../../context/context-builder.js";
import { Team } from "../../agents/team.js";

// Mock adapter
const mockAdapter = {
  chat: async (model, system, user) => `[${model}] 모의 응답: ${user.substring(0, 50)}`,
  generateCode: async (model, system, prompt) => "```js\nconsole.log('mock');\n```",
  reviewCode: async (model, system, code, criteria) => "Approved. 좋은 코드입니다.",
};

describe("회의 흐름 통합 테스트", () => {
  it("2라운드 회의 후 SharedContext에 요약이 저장된다", async () => { /* ... */ });
  it("모든 발언이 Mailbox에 기록된다", async () => { /* ... */ });
  it("토큰 사용량이 maxChars를 초과하지 않는다", async () => { /* ... */ });
});
```

#### 시나리오 2: 개발-리뷰-수정 루프 통합 테스트

**목적**: Phase 5-6의 수정 루프가 SharedContext/Mailbox 기반으로 동작하는지 검증

```javascript
describe("개발-리뷰-수정 루프", () => {
  it("리뷰 피드백이 Mailbox로 전달되어 수정에 반영된다", async () => { /* ... */ });
  it("수정된 코드가 SharedContext에 업데이트된다", async () => { /* ... */ });
  it("review.verdict가 SharedContext에 저장된다", async () => { /* ... */ });
});
```

#### 시나리오 3: QA-수정 루프 통합 테스트

```javascript
describe("QA-수정 루프", () => {
  it("QA 실패 시 팀장 분석이 Mailbox로 전달된다", async () => { /* ... */ });
  it("수정 후 재테스트가 정상 진행된다", async () => { /* ... */ });
  it("qa.verdict가 SharedContext에 저장된다", async () => { /* ... */ });
});
```

#### 시나리오 4: 전체 파이프라인 통합 테스트 (E2E)

**전제 조건**: API 키 필요, GitHub 토큰 불필요 (Mock)

```javascript
describe("전체 파이프라인 E2E", () => {
  it("Phase 1-8이 순서대로 진행된다", async () => { /* ... */ });
  it("SharedContext snapshot이 모든 Phase의 데이터를 포함한다", async () => { /* ... */ });
  it("Mailbox exportLog가 전체 소통 이력을 포함한다", async () => { /* ... */ });
});
```

### 5.6 Mock 전략

모든 테스트에서 `ModelAdapter`를 Mock으로 대체한다:

```javascript
function createMockAdapter(responses = {}) {
  return {
    chat: async (model, system, user) => {
      return responses.chat || `모의 응답 from ${model}`;
    },
    generateCode: async (model, system, prompt) => {
      return responses.code || "```js\n// mock code\n```";
    },
    reviewCode: async (model, system, code, criteria) => {
      return responses.review || "Approved";
    },
  };
}
```

이로써 API 키 없이도 전체 흐름을 검증할 수 있다. GitHub 클라이언트도 동일하게 Mock 처리:

```javascript
function createMockGitHub() {
  let issueCounter = 1;
  return {
    createIssue: async (title, body, labels) => ({ number: issueCounter++, node_id: `node-${issueCounter}` }),
    addComment: async () => ({}),
    updateLabels: async () => ({}),
    closeIssue: async () => ({}),
    createBranch: async () => "mock-branch",
    commitFile: async () => ({}),
    createPR: async () => ({ number: 100 }),
    ensureLabels: async () => {},
    findOrCreateProject: async () => ({ id: "proj-1", number: 1 }),
    addIssueToProject: async () => ({ id: "item-1" }),
  };
}
```

---

## 6. 리스크 분석

### 6.1 마이그레이션 리스크

| 리스크 | 확률 | 영향 | 완화 전략 |
|--------|------|------|----------|
| **메서드 시그니처 변경으로 인한 런타임 에러** | 높음 | 높음 | Step 4-7을 한 세션에 연속 수행. 중간에 main에 커밋하지 않음 |
| **기존 meetingLog 구조 변경으로 formatMeetingAsMarkdown 깨짐** | 중간 | 중간 | meetingLog 구조는 유지하되, 내부 조립 방식만 변경. formatMeetingAsMarkdown 최소 변경 |
| **contextBundle 타입 불일치** | 중간 | 높음 | 각 build 메서드의 반환 타입을 JSDoc으로 명시. TypeScript 마이그레이션은 향후 고려 |
| **orchestrator.js의 this.state 참조 누락** | 높음 | 중간 | this.state 참조를 모두 grep하여 변환 체크리스트 작성 |
| **루트 orchestrator.js (중복 파일) 미갱신** | 낮음 | 낮음 | 루트 orchestrator.js는 src/pipeline/orchestrator.js의 사본으로 보임. 동기화 필요 여부 확인 |

### 6.2 토큰 예산 초과 시 대응

#### 상황 1: 필수 슬롯만으로 예산 초과

```
project.requirement (2000자) + project.title (50자) = 2050자
→ maxChars 6000에서 3950자 남음 → 정상
```

만약 requirement가 5000자를 초과하는 경우:

**대응**: `serialize()`에서 필수 슬롯도 truncate 가능하도록 옵션 추가
```javascript
// 필수 슬롯에 대해서도 maxSlotChars 제한 적용
serialize(slotNames, { maxChars, maxSlotChars = maxChars / 2, ... })
```

#### 상황 2: 수정 루프에서 피드백 누적으로 예산 초과

여러 번의 리뷰/QA 반복 시 피드백이 누적될 수 있다.

**대응**:
- `buildForFix()`에서 **최신 피드백만** 포함 (이전 피드백은 제외)
- Mailbox의 `unreadOnly` 필터 활용
- SharedContext의 리뷰/QA 슬롯은 최신 값으로 덮어쓰기

#### 상황 3: 코드 아티팩트가 거대한 경우

생성된 코드가 10,000자 이상인 경우:

**대응**:
- `code.<taskId>` 슬롯에 저장 시 `summary` 필드에 코드 요약(첫 500자 + 함수 시그니처 목록)을 포함
- `buildForReview()`, `buildForQA()`에서 코드는 별도 반환값으로 처리 (예산에서 제외)
- 코드 자체는 LLM의 context window 한계까지 허용하되, **보조 맥락을 줄여** 총 프롬프트 크기를 관리

### 6.3 폴백 전략

#### 단계적 폴백 (Graceful Degradation)

```javascript
// ContextBuilder 내부 폴백 체인
buildForCoding(agentId, taskId) {
  try {
    // 1차: 정상 조립
    return this._buildForCodingFull(agentId, taskId);
  } catch (e) {
    console.warn(`ContextBuilder 폴백 활성화: ${e.message}`);
    // 2차: 최소 맥락
    return this._buildForCodingMinimal(agentId, taskId);
  }
}

_buildForCodingMinimal(agentId, taskId) {
  // 필수 정보만 포함
  const task = this._findTask(taskId);
  return {
    systemContext: `프로젝트: ${this.shared.get("project.title") || ""}`,
    taskDescription: task?.description || "",
    acceptanceCriteria: task?.acceptance_criteria?.join("\n") || "",
  };
}
```

#### 전체 시스템 폴백

만약 SharedContext/Mailbox에 치명적 에러가 발생하면:

```javascript
// orchestrator.js에서 Phase별 try-catch
async phaseDevelopment() {
  for (const task of this.state.taskIssues) {
    try {
      const contextBundle = this.contextBuilder.buildForCoding(agent.id, task.taskId);
      const result = await agent.writeCode(contextBundle);
      // ...
    } catch (contextError) {
      console.warn(`컨텍스트 조립 실패, 레거시 모드로 전환: ${contextError.message}`);
      // 레거시 폴백: 직접 파라미터 전달 (기존 방식)
      const result = await agent.writeCode({
        systemContext: "",
        taskDescription: task.description,
        acceptanceCriteria: task.acceptance_criteria?.join("\n") || "",
      });
    }
  }
}
```

### 6.4 점진적 마이그레이션 vs 빅뱅 전환

#### 권장: 빅뱅 전환 (Feature Branch)

**이유:**
1. 메서드 시그니처 변경은 모든 호출처에 영향을 줌 -> 부분 적용 불가
2. 새 모듈 3개는 독립적으로 구현 및 테스트 가능 -> 리스크가 Step 4-7에 집중됨
3. 프로젝트가 아직 초기 단계(v0.1.0)이며 사용자가 적음

**전략:**
```
main ─────────────────────────────────────────────
       \                                        /
        feature/shared-context-mailbox ────────
         Step 1-8 모두 이 브랜치에서 수행
         Step 8 완료 후 main에 병합
```

**롤백 계획:**
- feature 브랜치에서 작업하므로, 실패 시 브랜치 삭제로 원복 가능
- 각 Step 완료 시 중간 커밋을 남겨, 특정 Step으로 되돌리기 가능

### 6.5 성능 리스크

| 항목 | Before | After | 비고 |
|------|--------|-------|------|
| 메모리 사용 | this.state에 모든 데이터 저장 | SharedContext Map + Mailbox 배열 | 유사하거나 소폭 증가 |
| 회의 토큰 사용 | O(N * R^2) | O(N * min(R, maxSpeeches)) | 대폭 감소 |
| 수정 루프 토큰 | substring 고정 | 우선순위 기반 동적 조립 | 효율화 |
| 프롬프트 조립 시간 | 문자열 연결 | Map 조회 + 조건부 직렬화 | 무시할 수준의 차이 |

### 6.6 운영 리스크

| 리스크 | 완화 |
|--------|------|
| 디버깅 어려움 (맥락이 어디서 왔는지 추적) | SharedContext.history + Mailbox.exportLog()로 전체 흐름 추적 가능 |
| 메시지 유실 (Mailbox 인메모리) | 파이프라인이 단일 프로세스에서 동기적으로 실행되므로 유실 가능성 없음 |
| SharedContext 슬롯 이름 오타 | 상수로 슬롯 이름 관리 (향후 enum/const 도입) |

---

## 부록 A: 파일 목록 및 변경 상태

| 파일 경로 | 상태 | 변경 규모 |
|-----------|------|----------|
| `src/context/shared-context.js` | **신규** | ~150행 |
| `src/context/mailbox.js` | **신규** | ~200행 |
| `src/context/context-builder.js` | **신규** | ~300행 |
| `src/context/__tests__/shared-context.test.js` | **신규** | ~100행 |
| `src/context/__tests__/mailbox.test.js` | **신규** | ~150행 |
| `src/context/__tests__/context-builder.test.js` | **신규** | ~150행 |
| `src/agents/agent.js` | **수정** | 시그니처 변경, ~50행 변경 |
| `src/agents/team.js` | **수정** | 생성자 + conductMeeting, ~60행 변경 |
| `src/pipeline/orchestrator.js` | **수정** | 전면 리팩터링, ~200행 변경 |
| `src/index.js` | **수정** | 배선 변경, ~30행 변경 |
| `package.json` | **수정** | test 스크립트 추가, ~3행 추가 |

## 부록 B: 리서치 참고자료

아키텍처 설계에 참고한 주요 패턴 및 모범 사례:

1. **Blackboard 패턴**: 이종(heterogeneous) 에이전트가 공유 작업 공간에 부분 결과를 게시하고 다른 에이전트가 관찰/정제하는 비동기 협업 패턴. 슬롯 기반 접근으로 구현하며, public/private 영역 분리를 권장한다.

2. **Mailbox-per-agent 패턴**: 각 에이전트에 전용 수신함을 부여하여 교차 에이전트 경합을 줄이고 프라이버시 경계를 지원한다. 타입별 메시지 분류로 선택적 참조가 가능하다.

3. **토큰 예산 관리**: 우선순위 기반 컨텍스트 조립이 핵심이다. 의미적 관련성(semantic relevance), 최신성(recency), 역할 기반 우선순위(role-based priority)를 복합 점수로 계산하여 예산 내에서 가장 중요한 맥락을 선택한다. 프루닝(pruning)으로 ~40%의 토큰 절감이 가능하다는 연구 결과가 있다.

4. **출처 추적(Provenance)**: 프롬프트, 응답, 도구 호출, 메모리 업데이트를 기록하여 추적성과 감사 가능성을 확보한다. 변경 이력(history)과 메시지 로그(allMessages)로 구현한다.

5. **3계층 메모리 아키텍처**: 휘발성 캐시(Redis), 의미 검색(pgvector), 임베딩(OpenAI)의 3계층 구조가 권장되나, 현재 프로젝트의 규모와 단일 프로세스 특성상 인메모리 Map으로 충분하다. 향후 확장 시 Redis 도입을 고려한다.

---

*본 문서는 Agent Team CLI v0.1.0 코드베이스 분석 및 멀티에이전트 시스템 아키텍처 리서치를 기반으로 작성되었습니다.*
