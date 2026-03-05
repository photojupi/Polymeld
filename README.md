# Agent Team CLI

**멀티 AI 모델 기반 개발팀 시뮬레이션**

Claude Code, Gemini CLI, Codex CLI를 각 페르소나에 배정하고,
회의 → 설계 → 개발 → 리뷰 → QA → PR 생성까지 자동화합니다.

## 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                      Agent Team CLI                         │
│                  (Node.js 오케스트레이터)                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  REPL Shell (Interactive)   ←→   Session (Context 유지)     │
│  /help /status /save /load       SessionStore (디스크 저장)  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  SharedContext          Mailbox           ContextBuilder     │
│  (Blackboard 패턴)     (메시지 라우팅)    (토큰 예산 조립)    │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ Claude   │    │ Gemini   │    │ Codex    │              │
│  │ Code CLI │    │ CLI      │    │ CLI      │              │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘              │
│       │               │               │                     │
│  ┌────┴────┐   ┌──────┴──────┐  ┌─────┴─────┐             │
│  │ 김아키   │   │ 류창작      │  │ 한코딩    │              │
│  │ (팀장)   │   │ 박유아이    │  │ (에이스)  │              │
│  └─────────┘   │ 윤디자인*   │  │ 정테스트  │              │
│                │ 그림솔*     │  │ 이서버    │              │
│                └─────────────┘  │ 최배포    │              │
│                                  └──────────┘              │
│  * 디자이너/원화가는 이미지 생성 시 Nano Banana 2 사용       │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                  GitHub Integration                         │
│      Issues │ Comments │ Projects │ Branches │ PRs          │
└─────────────────────────────────────────────────────────────┘
```

## 빠른 시작

```bash
# 1. 클론 및 설치
git clone <this-repo>
cd agent-team-cli
npm install

# 2. CLI 도구 설치 (미설치 시)
npm install -g @anthropic-ai/claude-code  # Claude Code
npm install -g @google/gemini-cli          # Gemini CLI
npm install -g @openai/codex               # Codex CLI

# 3. 환경 변수 설정 (GitHub 연동용)
export GITHUB_TOKEN=ghp_xxxxx
export GITHUB_REPO=owner/repo

# 4. 설정 확인
node src/index.js test-models

# 5. 실행!
node src/index.js run "사용자 인증 기능 구현 (이메일/비밀번호 + OAuth)"
```

## 설정

### 환경 변수 (GitHub 연동용)
```bash
GITHUB_TOKEN=ghp_xxxxx            # GitHub 연동용
GITHUB_REPO=owner/repo            # 대상 리포지터리
```

> 참고: API 키는 각 CLI 도구가 자체적으로 관리합니다 (각 CLI의 인증 방식을 따르세요).

### agent-team.config.yaml

#### 모델 정의

사용할 AI 모델과 CLI 매핑을 정의합니다:

```yaml
models:
  claude:
    cli: claude
    model: claude-opus-4-6
  gemini:
    cli: gemini
    model: gemini-3.1-pro-preview
  codex:
    cli: codex
    model: gpt-5.3-codex
  gemini_image:
    cli: gemini
    model: gemini-3.1-flash-image    # Nano Banana 2 (이미지 생성 특화)
```

#### 페르소나 배정

각 페르소나에 모델을 배정합니다. `on_demand: true`로 설정하면 팀장이 필요 시에만 소집합니다:

```yaml
personas:
  # 상시 투입
  tech_lead:
    name: 김아키
    model: claude

  ace_programmer:
    name: 한코딩
    model: codex

  creative_programmer:
    name: 류창작
    model: gemini

  qa:
    name: 정테스트
    model: codex

  # 온디맨드 (필요 시 소집)
  backend_dev:
    name: 이서버
    model: codex
    on_demand: true

  designer:
    name: 윤디자인
    model: gemini             # 대화/설계 시 Gemini 3.1 Pro
    image_model: gemini_image # 이미지 생성 시 Nano Banana 2
    on_demand: true
```

#### image_model (이미지 생성)

`image_model` 필드를 설정하면 해당 페르소나가 이미지 생성 태스크를 수행할 수 있습니다:
- **대화/설계/리뷰**: 기본 `model` 사용 (예: Gemini 3.1 Pro)
- **이미지 생성**: `image_model` 사용 (예: Nano Banana 2)
- 이미지 태스크 자동 감지: 태스크 제목/설명에 디자인, 목업, 아이콘, 일러스트 등 키워드 포함 시
- `image_model`은 선택적 — 미설정 시 텍스트 전용 에이전트로 동작

### 페르소나 구성 (기본값)

| 페르소나 | 역할 | 모델 | 이미지 모델 | 투입 |
|---------|------|------|-----------|------|
| 김아키 | Tech Lead | Claude Opus 4.6 | - | 상시 |
| 한코딩 | Ace Programmer | GPT-5.3 Codex | - | 상시 |
| 류창작 | Creative Programmer | Gemini 3.1 Pro | - | 상시 |
| 정테스트 | QA Engineer | GPT-5.3 Codex | - | 상시 |
| 이서버 | Backend Dev | GPT-5.3 Codex | - | 온디맨드 |
| 박유아이 | Frontend Dev | Gemini 3.1 Pro | - | 온디맨드 |
| 최배포 | DevOps | GPT-5.3 Codex | - | 온디맨드 |
| 윤디자인 | UI/UX Designer | Gemini 3.1 Pro | Nano Banana 2 | 온디맨드 |
| 그림솔 | Illustrator | Gemini 3.1 Pro | Nano Banana 2 | 온디맨드 |

## 사용법

### 전체 파이프라인 실행
```bash
# 대화형 모드 (각 Phase마다 확인)
node src/index.js run "실시간 채팅 기능 구현"

# 비대화형 모드 (자동 진행)
node src/index.js run "실시간 채팅 기능 구현" --no-interactive

# 프로젝트 제목 지정
node src/index.js run "채팅 기능" --title "실시간 채팅 v1.0"

# 인터랙션 모드 지정
node src/index.js run "채팅 기능" --mode full-auto
node src/index.js run "채팅 기능" --mode semi-auto   # 기본값
node src/index.js run "채팅 기능" --mode manual
```

### 회의만 진행
```bash
# 킥오프 미팅
node src/index.js meeting kickoff "사용자 인증 기능 구현"

# 기술 설계 미팅 (3라운드 토론)
node src/index.js meeting design "마이크로서비스 아키텍처 전환" --rounds 3
```

### 모델 연결 테스트
```bash
node src/index.js test-models
```

### 인터랙티브 REPL 모드
```bash
# REPL 시작
node src/index.js start

# 이전 세션 이어하기 (가장 최근 세션)
node src/index.js start --resume

# 특정 세션 복원
node src/index.js start --resume <sessionId>

# 인터랙션 모드 지정
node src/index.js start --mode full-auto
```

REPL 모드에서는 프롬프트에서 자연어로 요구사항을 입력하면 전체 파이프라인이 실행됩니다.
실행이 끝나면 다시 프롬프트로 돌아와 새로운 명령을 내릴 수 있습니다.
세션 컨텍스트(SharedContext, Mailbox, 실행 이력)가 유지됩니다.

**슬래시 명령어:**

| 명령어 | 설명 |
|--------|------|
| `/help` | 사용 가능한 명령어 목록 |
| `/status` | 현재 세션 상태 |
| `/history` | 파이프라인 실행 이력 |
| `/context` | SharedContext 슬롯 확인 |
| `/team` | 팀 구성 확인 |
| `/save` | 세션 저장 |
| `/load [id]` | 세션 복원 |
| `/exit` | REPL 종료 |

### 설정 초기화
```bash
node src/index.js init
```

## 파이프라인 상세

```
Phase 1: 킥오프 미팅
  → 페르소나들이 각자의 AI 모델로 의견 제시
  → 회의록이 GitHub Issue에 자동 등록

Phase 2: 기술 설계 미팅
  → 페르소나 간 의견 충돌/합의 시뮬레이션
  → 서로 다른 모델이 서로 다른 관점으로 토론
  → 설계 결정 문서가 GitHub Issue에 등록

Phase 3: 태스크 분해
  → 팀장이 1-4시간 단위로 태스크 분해
  → 각 태스크가 GitHub Issue로 생성 (backlog 라벨)

Phase 4: 작업 분배
  → 팀장이 각 태스크를 적합한 페르소나에게 배정
  → 이미지 태스크는 image_model 보유 에이전트에게 우선 배정
  → 배정 이유가 Issue Comment로 기록

Phase 5: 개발
  → 각 페르소나가 자신의 AI 모델로 코드 작성
  → 이미지 태스크: image_model로 이미지 생성 (output/images/ 저장)
  → feature 브랜치에 커밋
  → 진행 상황이 Issue Comment로 업데이트

Phase 6: 코드 리뷰
  → 팀장이 다른 모델이 작성한 코드를 리뷰
  → 리뷰 → 수정 → 재리뷰 사이클 (최대 3회)
  → 리뷰 결과가 Issue Comment로 기록

Phase 7: QA
  → QA가 코드 검증
  → QA 실패 → 팀장 분석 → 수정 → 재검증 (최대 3회)
  → 테스트 결과가 Issue Comment에 표 형태로 기록

Phase 8: PR 생성
  → 모든 이력(회의록, 리뷰, QA)이 링크된 PR 자동 생성
```

## 내부 아키텍처

### 3대 컨텍스트 구성요소

| 구성요소 | 역할 | 비유 |
|---------|------|------|
| **SharedContext** | 전역 공유 저장소 (Blackboard 패턴) | 화이트보드 |
| **Mailbox** | 에이전트 간 메시지 라우팅 | 우편함 |
| **ContextBuilder** | 토큰 예산 내 맥락 조립 | 비서 |

### SharedContext 슬롯 카탈로그

```
project.requirement     - 원본 요구사항 텍스트
project.title           - 프로젝트 제목
meeting.kickoff.*       - 킥오프 미팅 요약/핵심 포인트
design.*                - 설계 결정, 기술 스택, 아키텍처
planning.*              - 태스크 목록, 담당자 매핑
code.<taskId>           - 생성된 코드 아티팩트
review.<taskId>         - 리뷰 결과 및 판정
qa.<taskId>             - QA 결과 및 판정
image.<taskId>          - 이미지 생성 결과
```

### 프로젝트 구조

```
src/
├── index.js                  # CLI 엔트리포인트 (Commander.js)
├── config/
│   ├── loader.js             # YAML 설정 로더 + CLI 검증
│   └── interaction.js        # 인터랙션 모드 관리
├── models/
│   └── adapter.js            # CLI 추상화 (claude/gemini/codex)
├── agents/
│   ├── agent.js              # 개별 에이전트 (페르소나)
│   └── team.js               # 팀 관리자 (오케스트레이션)
├── context/
│   ├── shared-context.js     # Blackboard 패턴 전역 저장소
│   ├── mailbox.js            # 에이전트 간 메시지 라우팅
│   └── context-builder.js    # 토큰 예산 맥락 조립기
├── pipeline/
│   └── orchestrator.js       # 8-Phase 파이프라인 실행
├── repl/
│   ├── repl-shell.js         # 인터랙티브 REPL 루프 (readline)
│   ├── command-router.js     # 슬래시 명령어 라우팅
│   └── commands/             # 슬래시 명령어 핸들러
│       ├── help.js
│       ├── status.js
│       ├── history.js
│       ├── context.js
│       ├── team.js
│       ├── save.js
│       └── load.js
├── session/
│   ├── session.js            # 세션 (컨텍스트 + 실행 이력 묶음)
│   └── session-store.js      # 세션 디스크 저장/복원
└── github/
    └── client.js             # GitHub API (Issues, PRs, Projects)
```

## GitHub에 기록되는 항목

모든 과정이 GitHub에 추적 가능하게 기록됩니다:

- **회의록**: Issue (meeting-notes 라벨)
- **태스크**: Issue (backlog → todo → in-progress → done)
- **배정 기록**: Issue Comment
- **개발 로그**: Issue Comment + Commit
- **이미지 생성 결과**: Issue Comment (파일 경로 + 텍스트 설명)
- **페르소나 간 논의**: Issue Comment
- **코드 리뷰**: Issue Comment
- **QA 결과**: Issue Comment
- **최종 결과물**: Pull Request

각 기록에는 어떤 AI CLI가 수행했는지 태그됩니다 (예: `[claude]`, `[gemini]`, `[codex]`).

## Claude Code 연동

이 CLI를 Claude Code에서도 호출할 수 있습니다:

```bash
# Claude Code 내에서
node /path/to/agent-team-cli/src/index.js run "요구사항" --no-interactive
```

또는 CLAUDE.md에 등록:
```markdown
## Agent Team
프로젝트 요구사항이 주어지면 agent-team CLI를 실행하세요:
`node ./agent-team-cli/src/index.js run "요구사항" --no-interactive`
```

## 페르소나 커스터마이징

`agent-team.config.yaml`에서 페르소나를 추가/수정할 수 있습니다:

```yaml
personas:
  security_expert:
    name: 한보안
    role: Security Engineer
    model: claude
    description: "보안에 편집증적으로 집착. 모든 입력을 의심."
    expertise:
      - 보안 취약점 분석
      - 인증/인가 설계
      - 암호화 전략

  concept_artist:
    name: 이컨셉
    role: Concept Artist
    model: gemini              # 토론/기획 시 텍스트 모델
    image_model: gemini_image  # 이미지 생성 시 이미지 모델
    on_demand: true
    description: "컨셉 아트와 비주얼 디자인 전문가"
    expertise:
      - 컨셉 아트 제작
      - 캐릭터/배경 디자인
```

## 라이선스

MIT
