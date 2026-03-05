# REPL 모드 설계 문서

**날짜**: 2026-03-06
**상태**: 승인됨

## 목표

기존 원샷 CLI에 인터랙티브 REPL 셸을 추가한다.
파이프라인 실행 자체는 기존과 동일한 원샷 방식을 유지하되,
REPL이 감싸서 실행 완료 후 프롬프트로 돌아오고, 다음 명령을 받을 수 있게 한다.

## 사용 시나리오

```
$ agent-team start
🤖 Agent Team CLI v0.1.0

> 사용자 인증 시스템을 만들어줘
  [Phase 1~8 원샷 자동 실행... 실시간 로그 출력]
  ✅ 파이프라인 완료!

> /status
  📋 마지막 실행: 사용자 인증 시스템
  📝 태스크 4개 완료, PR #12 생성됨

> 로그인 화면에 소셜 로그인도 추가해줘
  [Phase 1~8 원샷 자동 실행... 이전 세션 맥락 유지]
  ✅ 파이프라인 완료!

> /exit
```

## 핵심 원칙

1. **원샷 유지**: 파이프라인 실행은 기존 PipelineOrchestrator 그대로 재사용
2. **세션 맥락 유지**: SharedContext + Mailbox가 실행 간에 유지되어 이전 작업 결과 참조 가능
3. **하이브리드 명령**: 슬래시 커맨드는 즉시 실행, 자연어는 파이프라인 실행
4. **기존 코드 무변경**: `PipelineOrchestrator`, `Agent`, `Team` 등 기존 코드 수정 없음
5. **세션 저장/복원**: JSON 직렬화로 중간에 나갔다 돌아올 수 있음

## 아키텍처

```
                    ┌──────────────────┐
                    │   src/index.js   │
                    │  (Commander.js)  │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
       start command    run command    기존 커맨드들
       (REPL 모드)     (원샷, 기존)    (meeting 등)
              │              │
              ▼              │
     ┌────────────────┐     │
     │  ReplShell     │     │
     │  (프롬프트 루프)│     │
     └───────┬────────┘     │
             │              │
     ┌───────▼────────┐     │
     │ CommandRouter   │     │
     │ /slash → 즉시   │     │
     │ 자연어 → 파이프  │     │
     └───────┬────────┘     │
             │              │
     ┌───────▼────────┐     │
     │    Session      │     │
     │ SharedContext    │     │
     │ Mailbox         │◄────┘ (run도 내부적으로 같은 객체 사용)
     │ Team            │
     │ runs[]          │
     └───────┬────────┘
             │
     ┌───────▼────────────────┐
     │ PipelineOrchestrator   │
     │ (기존 코드 그대로)       │
     └────────────────────────┘
```

## 파일 구조

### 신규 파일

```
src/
  repl/
    repl-shell.js         REPL 루프 (readline 기반, 프롬프트 관리)
    command-router.js      슬래시 커맨드 vs 자연어 분기
    commands/
      status.js           /status: 현재 세션 상태 출력
      history.js          /history: 실행 이력 조회
      save.js             /save: 세션 수동 저장
      load.js             /load: 세션 복원
      help.js             /help: 명령어 목록
  session/
    session.js            Session 클래스 (SharedContext+Mailbox+state 묶음)
    session-store.js      디스크 저장/복원
```

### 기존 파일 변경

- `src/index.js`: `start` 커맨드 추가 (REPL 진입점). 기존 커맨드는 변경 없음.

## 컴포넌트 상세

### Session

하나의 REPL 세션이 관리하는 모든 상태를 묶는다.

```js
class Session {
  id              // 세션 고유 ID
  config          // YAML에서 로드한 설정
  sharedContext   // SharedContext 인스턴스 (실행 간 유지)
  mailbox         // Mailbox 인스턴스 (실행 간 유지)
  contextBuilder  // ContextBuilder 인스턴스
  adapter         // ModelAdapter 인스턴스
  team            // Team 인스턴스 (lazy 초기화)
  github          // GitHubClient 인스턴스 (환경변수 있을 때만)
  runs            // 실행 이력 배열
  createdAt       // 세션 생성 시각

  async runPipeline(requirement, title, interactionMode)
  serialize() → object
  static deserialize(data, config) → Session
}
```

**runPipeline 동작:**
1. Team이 없으면 생성 (세션의 SharedContext/Mailbox 공유)
2. PipelineOrchestrator 인스턴스 생성 (세션의 contextDeps 전달)
3. orchestrator.run() 호출 (기존 원샷과 완전 동일)
4. 실행 결과를 runs 이력에 추가
5. SharedContext/Mailbox 상태는 자연스럽게 유지됨

### ReplShell

readline 기반 프롬프트 루프.

```js
class ReplShell {
  session         // Session 인스턴스
  commandRouter   // CommandRouter 인스턴스
  rl              // readline.Interface

  async start()           // 메인 루프
  async prompt() → string // 프롬프트 출력 및 입력 대기
  printBanner()           // 시작 배너
  handleExit()            // Ctrl+C / /exit 처리, 자동 저장
}
```

**프롬프트 형식:**
- 세션 없음: `> `
- 실행 후: `[사용자인증] > `  (마지막 프로젝트 제목)

### CommandRouter

입력을 슬래시 커맨드와 자연어로 분기.

```js
class CommandRouter {
  session          // Session 참조

  async handleSlash(input)    // /로 시작하는 명령 처리
  async handleNatural(input)  // 자연어 → runPipeline 호출
}
```

**슬래시 커맨드 목록:**

| 커맨드 | 설명 | LLM 호출 |
|--------|------|----------|
| `/status` | 현재 세션 상태 (phase, 태스크, 에이전트) | 없음 |
| `/history` | 실행 이력 목록 | 없음 |
| `/save [name]` | 세션 저장 | 없음 |
| `/load <name>` | 세션 복원 | 없음 |
| `/team` | 현재 팀 구성 출력 | 없음 |
| `/context` | SharedContext 슬롯 요약 | 없음 |
| `/help` | 명령어 도움말 | 없음 |
| `/exit` | REPL 종료 (자동 저장) | 없음 |

**자연어 처리:**
자연어 입력은 팀장에게 전달하지 않고, 바로 `session.runPipeline(input)` 실행.
(= 기존 `agent-team run "입력"` 과 동일)

### SessionStore

세션을 디스크에 저장/복원.

```
.agent-team/
  sessions/
    <id>.json       각 세션 파일
```

**저장 데이터:**
```json
{
  "id": "abc123",
  "createdAt": "2026-03-06T...",
  "updatedAt": "2026-03-06T...",
  "runs": [...],
  "sharedContext": { "slots": {...}, "history": [...] },
  "mailbox": { "allMessages": [...], "inboxes": {...}, "nextId": 42 },
  "orchestratorState": { "kickoffIssue": 1, "designIssue": 2, ... }
}
```

**복원 시:**
- SharedContext: slots Map 재구성
- Mailbox: allMessages + inboxes 재구성, _nextId 이어가기
- Team/Adapter: config에서 재생성 (stateless)
- OrchestratorState: 다음 파이프라인 실행에는 불필요하지만 /status 표시용으로 보존

## index.js 변경

```js
// 추가되는 커맨드
program
  .command("start")
  .description("인터랙티브 REPL 모드")
  .option("-c, --config <path>", "설정 파일 경로")
  .option("--resume [id]", "이전 세션 이어하기")
  .action(async (options) => {
    const config = loadConfig(options.config)
    const shell = new ReplShell(config)

    if (options.resume) {
      await shell.loadSession(options.resume)
    }

    await shell.start()
  })
```

기존 `run`, `meeting`, `test-models`, `init` 커맨드는 변경 없음.

## SharedContext/Mailbox 직렬화 설계

### SharedContext 직렬화

```js
// serialize
const data = {
  slots: Object.fromEntries(
    Array.from(this.slots.entries()).map(([k, v]) => [k, v])
  ),
  history: this.history,
}

// deserialize
const sc = new SharedContext()
for (const [name, entry] of Object.entries(data.slots)) {
  sc.slots.set(name, entry)
}
sc.history = data.history
```

### Mailbox 직렬화

```js
// serialize
const data = {
  allMessages: this.allMessages,
  inboxes: Object.fromEntries(
    Array.from(this.inboxes.entries()).map(([k, v]) => [k, v])
  ),
  nextId: this._nextId,
}

// deserialize
const mb = new Mailbox()
mb.allMessages = data.allMessages
mb._nextId = data.nextId
for (const [agentId, messages] of Object.entries(data.inboxes)) {
  mb.inboxes.set(agentId, messages)
}
```

## 에러 처리

- 파이프라인 실행 중 에러: 기존 InteractionManager가 처리 (변경 없음)
- REPL 레벨 에러: try-catch로 잡고 프롬프트로 복귀 (REPL 자체는 죽지 않음)
- Ctrl+C: 파이프라인 실행 중이면 중단, 프롬프트에서면 자동 저장 후 종료
- 세션 저장 실패: 경고 출력 후 계속 진행

## 의존성 변경

- 신규 의존성 없음 (readline은 Node.js 내장, 나머지는 기존 chalk/inquirer 재사용)
