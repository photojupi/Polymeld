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
│  validateConnections: CLI 설치 → 인증 프로브 → GitHub 검증   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  PipelineState              PromptAssembler                 │
│  (단일 상태 저장소)          (토큰 예산 맥락 조립)            │
│                                                             │
│  ModelSelector              ResponseParser                  │
│  (작업별 최적 모델 선택)     (LLM 응답 구조화 파싱)           │
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
│  │ (팀장)   │   │ 박유아이°   │  │ (에이스)  │              │
│  └─────────┘   │ 윤디자인*°  │  │ 정테스트  │              │
│                │ 그림솔*°    │  │ 이서버°   │              │
│                └─────────────┘  │ 최배포°   │              │
│                                  └──────────┘              │
│  * 이미지 생성 시 Nano Banana 2 사용                        │
│  ° on_demand: 팀장 판단에 따라 선택적 소집                    │
│                                                             │
├──────────────────────────┬──────────────────────────────────┤
│   LocalWorkspace         │       GitHub Integration         │
│   (로컬 Git 레포 연동)    │  Issues │ Comments │ Projects   │
│   파일 탐색/읽기/쓰기     │  Branches │ PRs │ Commits      │
│   git branch/commit/push │                                  │
└──────────────────────────┴──────────────────────────────────┘
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

# 3. 환경 변수 설정 (.env 파일)
cp .env.example .env
# .env 파일을 편집하여 GitHub 토큰과 리포지토리 설정
#   GITHUB_TOKEN=ghp_xxxxx
#   GITHUB_REPO=owner/repo

# 4. (선택) 로컬 워크스페이스 연동
# 대상 프로젝트 디렉토리에서 실행하면 자동 감지:
cd ~/projects/my-app && node /path/to/agent-team-cli/src/index.js start
# 또는 agent-team.config.yaml에 명시:
#   project:
#     local_path: ~/projects/my-app

# 5. 설정 확인 (CLI 인증 + GitHub 연동 자동 검증)
node src/index.js test-models

# 6. 실행!
node src/index.js run "사용자 인증 기능 구현 (이메일/비밀번호 + OAuth)"

# 7. 테스트
npm test
```

## 설정

### 환경 변수 (.env 파일)

프로젝트 루트에 `.env` 파일을 생성하여 설정합니다 (`dotenv` 자동 로드):

```bash
# .env.example을 복사하여 사용
cp .env.example .env
```

```bash
GITHUB_TOKEN=ghp_xxxxx            # GitHub Personal Access Token (repo, project 권한)
GITHUB_REPO=owner/repo            # 대상 리포지터리 (owner/repo 형식)
```

> **시작 시 자동 검증**: 실행 시 CLI 설치 → CLI 인증 → GitHub 연동을 순차적으로 확인하고 결과를 표시합니다. GitHub 연동 실패 시 구체적인 원인(토큰 미설정, 인증 실패, 권한 부족 등)을 안내합니다.

> 참고: AI CLI 도구의 API 키는 각 CLI가 자체적으로 관리합니다 (각 CLI의 인증 방식을 따르세요).

### agent-team.config.yaml

#### 프로젝트 설정 (로컬 워크스페이스)

에이전트가 기존 코드를 참고하고, 생성된 코드를 로컬 파일로 직접 저장하도록 설정합니다:

```yaml
# 로컬 Git 레포 경로를 지정하면 에이전트가 기존 코드를 참고하여 개발합니다.
# 미설정 시 현재 디렉토리의 .git을 자동 감지합니다.
project:
  local_path: ~/projects/my-app
```

> **자동 감지**: `project.local_path`를 설정하지 않아도, 대상 프로젝트 디렉토리에서 agent-team을 실행하면 `.git`을 자동 감지하여 워크스페이스로 사용합니다.

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
    thinking_budget: 100      # 페르소나별 오버라이드 (0-100)

  ace_programmer:
    name: 한코딩
    model: codex

  creative_programmer:
    name: 류창작
    model: gemini

  qa:
    name: 정테스트
    model: codex
    thinking_budget: 100

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

#### thinking_budget (AI 사고 깊이)

AI 모델의 추론 깊이를 0-100 스케일로 제어합니다:

```yaml
pipeline:
  thinking_budget: 70         # 전역 기본값 (0-100)

personas:
  tech_lead:
    thinking_budget: 100      # 페르소나별 오버라이드
```

CLI별 변환:
| CLI | 파라미터 | 변환 |
|-----|---------|------|
| Claude | `--thinking-budget-tokens` | 0-100 → 0-10240 토큰 |
| Gemini | `--thinking-budget` | 0-100 → 0-24576 토큰 |
| Codex | `--reasoning-effort` | 0-25: low, 26-60: medium, 61-85: high, 86-100: xhigh |

#### 실시간 발언 미리보기

회의 중 각 AI의 응답이 생성되는 과정을 spinner에 실시간으로 표시합니다:

```
⠇ 한코딩 발언 중... 이 부분은 O(n log n)으로 풀 수 있습니다
```

터미널 너비에 맞춰 자동 잘림 처리되며, 스트리밍을 지원하는 CLI(Claude)에서 동작합니다. 버퍼링 출력 CLI(Codex)에서는 기존처럼 "발언 중..."만 표시됩니다.

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
세션 컨텍스트(PipelineState, 실행 이력)가 유지됩니다. 기존 v0 세션도 자동 마이그레이션됩니다.

**슬래시 명령어:**

| 명령어 | 설명 |
|--------|------|
| `/help` | 사용 가능한 명령어 목록 |
| `/status` | 현재 세션 상태 |
| `/history` | 파이프라인 실행 이력 |
| `/context` | PipelineState 상태 확인 |
| `/team` | 팀 구성 확인 |
| `/save` | 세션 저장 |
| `/load [id]` | 세션 복원 |
| `/exit` | REPL 종료 |

### 설정 초기화
```bash
node src/index.js init
```

## 로컬 워크스페이스 연동

로컬 Git 레포지토리를 워크스페이스로 지정하면, 에이전트가 **기존 코드를 읽고 참고하여 개발**하고, 생성된 코드를 **로컬 파일 시스템에 직접 저장**합니다.

### 동작 방식

| 기능 | 워크스페이스 설정 시 | 미설정 시 |
|------|---------------------|----------|
| 코드 참조 | 기존 파일 구조/내용을 LLM 프롬프트에 포함 | 설계 문서만 참고 |
| 코드 저장 | 로컬 파일로 직접 저장 + `git commit` | GitHub API로 커밋 |
| 브랜치 관리 | 로컬 `git checkout -b` | GitHub API로 브랜치 생성 |
| PR 생성 | 로컬 `git push` → GitHub PR | GitHub API 전용 |

### 워크스페이스 감지 우선순위

1. `agent-team.config.yaml`의 `project.local_path` 설정
2. 현재 디렉토리의 `.git` 자동 감지 (agent-team 자체 레포 제외)
3. 미감지 시 `NoOpWorkspace`로 GitHub API 전용 모드

### 개발 Phase에서의 동작

워크스페이스가 연동되면 Phase 5(개발)에서:
- 디렉토리 구조 트리를 캐싱하여 LLM에 제공
- 태스크별로 키워드 기반 관련 파일을 검색하여 코드 맥락 제공
- 태스크별 feature 브랜치 자동 생성 (`feature/{issueNumber}-{title}`)
- 생성된 코드를 로컬 파일로 저장 후 `git add` + `git commit`
- Phase 6(리뷰)/Phase 7(QA) 수정 시에도 로컬 재커밋

## 파이프라인 상세

```
Phase 1: 킥오프 미팅
  → 페르소나들이 각자의 AI 모델로 의견 제시
  → 회의록이 GitHub Issue에 자동 등록

Phase 2: 기술 설계 미팅
  → 페르소나 간 의견 충돌/합의 시뮬레이션
  → 서로 다른 모델이 서로 다른 관점으로 토론
  → 설계 결정 문서가 GitHub Issue에 등록

Phase 3: 태스크 분해 + on_demand 소집
  → 팀장이 1-4시간 단위로 태스크 분해
  → 각 태스크가 GitHub Issue로 생성 (backlog 라벨)
  → 태스크의 suitable_role 분석 → 필요한 온디맨드 페르소나 자동 소집
  → ModelSelector가 분석에 최적인 모델(claude) 자동 선택

Phase 4: 작업 분배
  → 팀장이 각 태스크를 적합한 페르소나에게 배정 (상시 + 소집된 온디맨드)
  → 이미지 태스크는 image_model 보유 에이전트에게 우선 배정
  → 배정 이유가 Issue Comment로 기록

Phase 5: 개발
  → 각 페르소나가 자신의 AI 모델로 코드 작성
  → ModelSelector가 코드 생성에 최적인 모델(codex) 자동 선택
  → 이미지 태스크: image_model로 이미지 생성 (output/images/ 저장)
  → feature 브랜치에 커밋
  → 진행 상황이 Issue Comment로 업데이트

Phase 6: 코드 리뷰
  → 팀장이 다른 모델이 작성한 코드를 리뷰
  → ResponseParser가 APPROVED / CHANGES_REQUESTED 판정 추출
  → 리뷰 → 수정 → 재리뷰 사이클 (최대 3회)
  → 리뷰 결과가 Issue Comment로 기록

Phase 7: QA
  → QA가 코드 검증
  → ResponseParser가 PASS / FAIL 판정 추출
  → QA 실패 → 팀장 분석 → 수정 → 재검증 (최대 3회)
  → 테스트 결과가 Issue Comment에 표 형태로 기록

Phase 8: PR 생성
  → 모든 이력(회의록, 리뷰, QA)이 링크된 PR 자동 생성
```

## 내부 아키텍처

### 핵심 구성요소

| 구성요소 | 역할 | 설명 |
|---------|------|------|
| **PipelineState** | 단일 상태 저장소 | 프로젝트/태스크/메시지/소집 기록을 명시적 필드로 관리 |
| **PromptAssembler** | 토큰 예산 맥락 조립 | 작업 유형별 필요 정보만 추출하여 LLM 프롬프트 구성 (코드베이스 맥락 포함) |
| **ModelSelector** | 작업별 최적 모델 선택 | 사용자 오버라이드 → 친화도 매트릭스 → 기본값 폴백 |
| **ResponseParser** | LLM 응답 구조화 파싱 | JSON 추출 + 키워드 폴백으로 판정(verdict) 추출 |
| **LocalWorkspace** | 로컬 Git 레포 연동 | 파일 탐색/읽기/쓰기 + git 브랜치/커밋/푸시 자동화 |
| **validateConnections** | 시작 시 연결 검증 | CLI 설치 → 인증 프로브 → GitHub 토큰/권한 확인을 실시간 표시 |

### PipelineState 필드 카탈로그

```
project.requirement     - 원본 요구사항 텍스트
project.title           - 프로젝트 제목
kickoffSummary          - 킥오프 미팅 요약
designDecisions         - 설계 결정 사항
techStack               - 기술 스택
tasks[]                 - 분해된 태스크 목록 (코드/리뷰/QA 결과 포함)
completedTasks[]        - 완료된 태스크
messages[]              - 에이전트 간 전체 메시지 (Mailbox 통합)
mobilizedAgents[]       - on_demand 소집된 에이전트 ID
github.kickoffIssue     - GitHub 킥오프 Issue 번호
github.designIssue      - GitHub 설계 Issue 번호
```

### ModelSelector — 작업-모델 친화도

| 작업 | 선호 모델 | 이유 |
|------|----------|------|
| breakdownTasks | claude | 분석/추론에 강점 |
| reviewCode | claude | 분석적 리뷰 |
| writeCode | codex | 코드 생성에 강점 |
| runQA | codex | 체계적 테스트 |
| generateImage | gemini_image | 멀티모달 |

### ResponseParser — LLM 응답 파싱

| 메서드 | 용도 | 반환 |
|--------|------|------|
| `parseTasks()` | Phase 3 태스크 분해 | 구조화된 태스크 배열 |
| `parseReviewVerdict()` | Phase 6 코드 리뷰 | APPROVED / CHANGES_REQUESTED |
| `parseQAVerdict()` | Phase 7 QA | PASS / FAIL |

### 프로젝트 구조

```
src/
├── index.js                  # CLI 엔트리포인트 (Commander.js) + dotenv 로드
├── config/
│   ├── loader.js             # YAML 설정 로더 + CLI/GitHub 연결 검증
│   └── interaction.js        # 인터랙션 모드 관리
├── models/
│   ├── adapter.js            # CLI 추상화 (claude/gemini/codex)
│   ├── model-selector.js     # 작업별 최적 모델 동적 선택
│   └── response-parser.js    # LLM 응답 구조화 파싱
├── agents/
│   ├── agent.js              # 개별 에이전트 (페르소나 + on_demand)
│   └── team.js               # 팀 관리자 (on_demand 소집 포함)
├── state/
│   ├── pipeline-state.js     # 단일 상태 저장소 (메시지 통합)
│   └── prompt-assembler.js   # 토큰 예산 맥락 조립기 (코드베이스 맥락 지원)
├── pipeline/
│   └── orchestrator.js       # 8-Phase 파이프라인 실행 (워크스페이스 연동)
├── workspace/
│   ├── local-workspace.js    # 로컬 Git 레포 워크스페이스 (파일 탐색/읽기/쓰기 + git CLI)
│   └── noop-workspace.js     # 워크스페이스 미설정 시 No-op 클라이언트
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
│   ├── session.js            # 세션 (PipelineState + 워크스페이스 + 실행 이력)
│   └── session-store.js      # 세션 디스크 저장/복원 (v0 자동 마이그레이션)
└── github/
    └── client.js             # GitHub API (Issues, PRs, Projects) + NoOpGitHub
test/
├── response-parser.test.js   # ResponseParser 단위 테스트
├── pipeline-state.test.js    # PipelineState 단위 테스트
└── prompt-assembler.test.js  # PromptAssembler 단위 테스트
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
