🌐 [한국어](README.md) | [English](README.en.md) | [日本語](README.ja.md) | [中文](README.zh-CN.md)

# Polymeld

**멀티 AI 모델 기반 개발팀 시뮬레이션**

Claude Code, Gemini CLI, Codex CLI를 각 페르소나에 배정하고,
회의 → 설계 → 개발 → 리뷰 → QA → PR 생성까지 자동화합니다.

## 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                      Polymeld                         │
│                  (Node.js 오케스트레이터)                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  REPL Shell (Interactive)   ←→   Session (Context 유지)     │
│  상태 바, 커맨드 메뉴,           SessionStore (디스크 저장)  │
│  Tab 자동완성, 멀티라인 입력      Phase 체크포인트/재개       │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  validateConnections: CLI 설치 → 인증 → GitHub 검증 + 스코프 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  PipelineState              PromptAssembler                 │
│  (단일 상태 저장소)          (Phase별 차등 토큰 예산)         │
│                                                             │
│  ResponseParser             ModelAdapter                    │
│  (LLM 응답 구조화 파싱)     (CLI 추상화 + thinking 매핑)     │
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
│  │ (팀장)   │   │ 박프론트    │  │ (에이스)  │              │
│  │ 안보안   │   │ 강기획      │  │ 정테스트  │              │
│  └─────────┘   │ 윤경험*     │  │ 이서버    │              │
│                │ 그림솔*     │  └──────────┘              │
│                └─────────────┘                              │
│  * 이미지 생성 시 Nano Banana 2 사용                        │
│  회의 중 [PASS]로 자발적 참여 조절                           │
│                                                             │
├──────────────────────────┬──────────────────────────────────┤
│   LocalWorkspace         │       GitHub Integration         │
│   (로컬 Git 레포 연동)    │  Issues │ Comments │ Projects   │
│   파일 탐색/읽기/쓰기     │  Branches │ PRs │ Commits      │
│   git branch/commit/push │  빈 레포 자동 초기화              │
└──────────────────────────┴──────────────────────────────────┘
```

## 빠른 시작

```bash
# 1. 클론 및 설치
git clone <this-repo>
cd polymeld
npm install
npm link                                    # `polymeld` 명령어를 전역으로 등록

# 2. CLI 도구 설치 (미설치 시)
npm install -g @anthropic-ai/claude-code  # Claude Code
npm install -g @google/gemini-cli          # Gemini CLI
npm install -g @openai/codex               # Codex CLI

# 3. 초기 설정 (대화형 위저드)
polymeld init --global      # 글로벌 설정 + 자격 증명 입력
# 또는 인수 없이 실행하면 온보딩 위저드가 자동으로 시작됩니다:
polymeld

# 4. (선택) 로컬 워크스페이스 연동
# 대상 프로젝트 디렉토리에서 실행하면 자동 감지:
cd ~/projects/my-app && polymeld start
# 또는 설정 파일에 명시:
#   project:
#     local_path: ~/projects/my-app

# 5. 설정 확인 (CLI 인증 + GitHub 연동 자동 검증)
polymeld test-models

# 6. 실행!
polymeld run "사용자 인증 기능 구현 (이메일/비밀번호 + OAuth)"

# 7. 언어 지정 (선택, 미지정 시 OS 로케일 자동 감지)
polymeld run "채팅 기능" --lang en   # English
polymeld run "채팅 기능" --lang ja   # 日本語
polymeld run "채팅 기능" --lang zh-CN # 中文(简体)

# 8. 테스트
npm test
```

> **첫 실행 시 온보딩**: `polymeld`를 인수 없이 실행하면, 글로벌 설정이 없는 경우 온보딩 위저드(모델 선택 → 자격 증명 입력)를 안내한 후 REPL 모드로 자동 진입합니다.

## 설정

### 환경 변수 (.env 파일)

프로젝트 루트에 `.env` 파일을 생성하여 설정합니다 (`dotenv` 자동 로드):

```bash
# .env.example을 복사하여 사용
cp .env.example .env
```

```bash
# GitHub Personal Access Token
# - Classic PAT: repo(필수) + project(선택, Projects 보드용) 스코프
# - Fine-grained PAT: Issues, Contents, Pull requests 쓰기 권한
GITHUB_TOKEN=ghp_xxxxx
GITHUB_REPO=owner/repo            # 대상 리포지터리 (owner/repo 형식)
```

> **시작 시 자동 검증**: CLI 설치 → CLI 인증 → GitHub 연동 + 토큰 스코프를 순차적으로 확인합니다. Classic PAT의 `project` 스코프 누락 시 경고를 표시합니다.

> 참고: AI CLI 도구의 API 키는 각 CLI가 자체적으로 관리합니다 (각 CLI의 인증 방식을 따르세요).

### 설정 파일 로드 순서

설정은 계층적으로 병합됩니다 (하위 레이어가 상위를 덮어씀):

| 우선순위 | 경로 | 용도 |
|---------|------|------|
| 1 (최상위) | `-c` 플래그 | 명시적 경로 지정 시 해당 파일만 사용 |
| 2 | `~/.polymeld/config.yaml` | 글로벌 설정 (모든 프로젝트 공통) |
| 3 | `.polymeld/config.yaml` | 프로젝트 공유 설정 (git 커밋 대상) |
| 4 | `.polymeld/config.local.yaml` | 프로젝트 로컬 설정 (개인용, .gitignore) |
| 5 | `polymeld.config.yaml` | 레거시 호환 |

### 자격 증명 관리

자격 증명은 `~/.polymeld/credentials.yaml`에 안전하게 저장됩니다 (파일 권한 `0600`):

```yaml
# ~/.polymeld/credentials.yaml
GITHUB_TOKEN: ghp_xxxxx
GITHUB_REPO: owner/repo
ANTHROPIC_API_KEY: sk-...
GOOGLE_API_KEY: AIzaSy...
OPENAI_API_KEY: sk-...
```

**로드 우선순위**: `.env` (dotenv) → `~/.polymeld/credentials.yaml` → 환경 변수 (`process.env` 우선)

> `polymeld auth`로 대화형으로 입력하거나, `polymeld auth --show`로 현재 설정 상태를 확인할 수 있습니다.

### config.yaml 설정 항목

#### 프로젝트 설정 (로컬 워크스페이스)

에이전트가 기존 코드를 참고하고, 생성된 코드를 로컬 파일로 직접 저장하도록 설정합니다:

```yaml
# 로컬 Git 레포 경로를 지정하면 에이전트가 기존 코드를 참고하여 개발합니다.
# 미설정 시 현재 디렉토리의 .git을 자동 감지합니다.
project:
  local_path: ~/projects/my-app
```

> **자동 감지**: `project.local_path`를 설정하지 않아도, 대상 프로젝트 디렉토리에서 Polymeld를 실행하면 `.git`을 자동 감지하여 워크스페이스로 사용합니다.

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
    model: gpt-5.4
  gemini_image:
    cli: gemini
    model: gemini-3.1-flash-image    # Nano Banana 2 (이미지 생성 특화)
```

#### CLI 실행 설정

```yaml
cli:
  timeout: 600000          # 기본 타임아웃 10분 (밀리초)
  timeouts:
    claude:                # 이중 타임아웃 (idle + max)
      idle: 300000         #   5분: 마지막 출력 이후 무응답 시 종료 (출력 있으면 리셋)
      max: 1800000         #   30분: 절대 상한 (무한 루프 방지)
    gemini: 600000         # 단일 타임아웃도 지원 (10분)
    codex:
      idle: 300000
      max: 1800000
  max_turns:
    claude: 10             # Claude 에이전틱 루프 최대 턴 수
```

> **이중 타임아웃**: `idle`은 출력이 있을 때마다 리셋되어 활발한 프로세스를 조기 종료하지 않고, `max`는 절대 상한으로 무한 루프를 방지합니다. 단일 숫자 값도 호환됩니다.

#### 페르소나 배정

각 페르소나에 모델을 배정합니다. 모든 페르소나가 회의에 참여하되, 기여할 내용이 없으면 `[PASS]`로 자발적으로 패스합니다:

```yaml
personas:
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

  designer:
    name: 윤경험
    model: gemini             # 대화/설계 시 Gemini 3.1 Pro
    image_model: gemini_image # 이미지 생성 시 Nano Banana 2
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
| Claude | `--effort` | 0-25: low, 26-75: medium, 76-100: high |
| Codex | `-c model_reasoning_effort` | 0-25: low, 26-60: medium, 61-85: high, 86-100: xhigh |
| Gemini | (CLI 플래그 미지원) | settings.json `thinkingConfig`으로만 제어 |

#### parallel_development (병렬 실행)

Phase 5(개발)에서 의존성이 없는 태스크들의 LLM 호출을 동시에 실행합니다:

```yaml
pipeline:
  parallel_development: true    # 기본값: true
```

- `true`: 의존성 그래프를 분석하여 독립 태스크를 배치 단위로 병렬 실행
- `false`: 기존 순차 실행 방식 유지
- Git 작업(브랜치 생성, 커밋)은 충돌 방지를 위해 항상 직렬 큐로 처리

#### 회의 시스템

**실시간 발언 미리보기**: 회의 중 각 AI의 응답이 생성되는 과정을 spinner에 실시간으로 표시하고, 완료 후 내용을 영구 출력합니다:

```
⠇ 한코딩 발언 중... 이 부분은 O(n log n)으로 풀 수 있습니다
✓ 한코딩: 이 부분은 O(n log n)으로 풀 수 있습니다. 분할 정복으로...
```

**자발적 패스 (`[PASS]`)**: 페르소나가 해당 주제에 기여할 내용이 없으면 `[PASS]`로 자동 건너뜁니다. 회의록에 패스 기록이 남습니다.

**조기 종료 (`[CONCLUDE]`)**: 팀장이 충분한 논의가 이루어졌다고 판단하면 `[CONCLUDE]`로 남은 라운드를 건너뛰고 회의를 종료합니다.

**라운드 표시**: 회의 라운드 전환 시 라운드 번호가 표시됩니다.

**이슈 제목 자동 생성**: 회의록 GitHub Issue의 제목을 팀장 AI가 한 줄 요약으로 생성합니다.

### 페르소나 구성 (기본값)

| 페르소나 | 역할 | 모델 | 이미지 모델 | thinking |
|---------|------|------|-----------|----------|
| 김아키 | Tech Lead (팀장) | Claude Opus 4.6 | - | 100 |
| 한코딩 | Ace Programmer | GPT-5.4 | - | - |
| 류창작 | Creative Programmer | Gemini 3.1 Pro | - | - |
| 정테스트 | QA Engineer | GPT-5.4 | - | 100 |
| 이서버 | Backend Developer | GPT-5.4 | - | - |
| 박프론트 | Frontend Engineer | Gemini 3.1 Pro | - | - |
| 강기획 | Ace Planner | Gemini 3.1 Pro | - | - |
| 안보안 | Security Expert | Claude Opus 4.6 | - | - |
| 윤경험 | UX/Visual Designer | Gemini 3.1 Pro | Nano Banana 2 | - |
| 그림솔 | Illustrator | Gemini 3.1 Pro | Nano Banana 2 | - |

> 모든 페르소나가 회의에 참여합니다. 관련 없는 주제에서는 `[PASS]`로 자발적으로 패스하고, 팀장은 `[CONCLUDE]`로 회의를 조기 종료할 수 있습니다.

## 사용법

### 전체 파이프라인 실행
```bash
# 전자동 모드 (기본값) — 모든 Phase 자동 진행
polymeld run "실시간 채팅 기능 구현"

# 인터랙션 모드 지정
polymeld run "채팅 기능" --mode full-auto   # 기본값
polymeld run "채팅 기능" --mode semi-auto   # Phase마다 확인
polymeld run "채팅 기능" --mode manual      # 수동 제어
```

> 프로젝트 제목은 워크스페이스 이름에서 자동 파생됩니다.

### 회의만 진행
```bash
# 킥오프 미팅
polymeld meeting kickoff "사용자 인증 기능 구현"

# 기술 설계 미팅 (3라운드 토론)
polymeld meeting design "마이크로서비스 아키텍처 전환" --rounds 3
```

### 모델 연결 테스트
```bash
polymeld test-models
```

### 인터랙티브 REPL 모드
```bash
# REPL 시작
polymeld start

# 이전 세션 이어하기 (가장 최근 세션)
polymeld start --resume

# 특정 세션 복원
polymeld start --resume <sessionId>

# 인터랙션 모드 지정
polymeld start --mode full-auto
```

REPL 모드에서는 프롬프트에서 자연어로 요구사항을 입력하면 전체 파이프라인이 실행됩니다.
실행이 끝나면 다시 프롬프트로 돌아와 새로운 명령을 내릴 수 있습니다.
세션 컨텍스트(PipelineState, 실행 이력)가 유지됩니다.

**REPL 기능:**
- **상태 바**: 프롬프트에 현재 세션 상태를 실시간 표시
- **커맨드 메뉴**: `/` 입력 시 검색 가능한 커맨드 메뉴 표시 (inquirer)
- **Tab 자동완성**: 슬래시 명령어 자동완성
- **멀티라인 입력**: Bracketed Paste Mode로 여러 줄 붙여넣기 지원

**슬래시 명령어:**

| 명령어 | 설명 |
|--------|------|
| `/help` | 사용 가능한 명령어 목록 |
| `/status` | 현재 세션 상태 |
| `/history` | 파이프라인 실행 이력 |
| `/context` | PipelineState 상태 확인 |
| `/team` | 팀 구성 확인 |
| `/resume` | 중단된 파이프라인 재개 (Phase 체크포인트 기반) |
| `/save` | 세션 저장 |
| `/load [id]` | 세션 복원 |
| `/exit` | REPL 종료 |

### 설정 초기화
```bash
# 글로벌 설정 초기화 (~/.polymeld/ 에 config.yaml + credentials.yaml)
polymeld init --global

# 프로젝트 설정 초기화 (.polymeld/config.yaml)
polymeld init
```

### 자격 증명 관리
```bash
# 대화형으로 토큰/API 키 입력
polymeld auth

# 현재 설정된 자격 증명 상태 확인 (마스킹됨)
polymeld auth --show
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

1. 설정 파일의 `project.local_path` 설정
2. 현재 디렉토리의 `.git` 자동 감지 (Polymeld 자체 레포 제외)
3. 미감지 시 `NoOpWorkspace`로 GitHub API 전용 모드

> `local_path` 설정 시 CLI 프로세스가 해당 경로에서 실행되므로, 에이전트가 해당 프로젝트의 파일을 직접 읽고 쓸 수 있습니다.

### 빈 GitHub 레포 자동 초기화

`GITHUB_REPO`로 지정된 레포가 비어있는 경우 자동으로:
1. Initial Commit을 생성하고
2. `GITHUB_REPO` 값으로 origin remote를 설정합니다

별도의 수동 초기화 없이 바로 사용할 수 있습니다.

### 개발 Phase에서의 동작

워크스페이스가 연동되면 Phase 5(개발)에서:
- 디렉토리 구조 트리를 캐싱하여 LLM에 제공
- 태스크별로 키워드 기반 관련 파일을 검색하여 코드 맥락 제공
- 태스크별 feature 브랜치 자동 생성 (`feature/{issueNumber}-{정제된 title}`)
- 의존성 기반 병렬 실행: 독립 태스크의 LLM 호출을 동시 실행 (Git 작업은 직렬 큐)
- 생성된 코드를 로컬 파일로 저장 후 `git add` + `git commit`
- Phase 6(리뷰)/Phase 7(QA) 수정 시에도 로컬 재커밋

## 파이프라인 상세

```
Phase 0: 코드베이스 분석 (수정 모드 + 로컬 워크스페이스 시)
  → 기존 코드베이스 구조 및 패턴 분석
  → 분석 결과를 이후 Phase에서 맥락으로 활용

Phase 1: 킥오프 미팅
  → 페르소나들이 각자의 AI 모델로 의견 제시
  → 관련 없는 페르소나는 [PASS]로 자발적 패스
  → 팀장이 [CONCLUDE]로 충분한 논의 후 조기 종료 가능
  → 이슈 제목은 팀장 AI가 한 줄 요약으로 자동 생성
  → 회의록이 GitHub Issue에 자동 등록
  → 킥오프 요약(kickoffSummary)이 이후 에이전트 프롬프트에 주입

Phase 2: 기술 설계 미팅
  → 페르소나 간 의견 충돌/합의 시뮬레이션
  → 서로 다른 모델이 서로 다른 관점으로 토론
  → [PASS] / [CONCLUDE] 동일 적용
  → 설계 결정 문서가 GitHub Issue에 등록

Phase 3: 태스크 분해
  → 팀장이 1-4시간 단위로 태스크 분해
  → 각 태스크가 GitHub Issue로 생성 (backlog 라벨)

Phase 4: 작업 분배
  → 팀장이 각 태스크를 적합한 페르소나에게 배정
  → 이미지 태스크는 image_model 보유 에이전트에게 우선 배정
  → 배정 이유가 Issue Comment로 기록

Phase 5: 개발 (의존성 기반 병렬 실행)
  → 태스크 간 의존성을 분석하여 독립 태스크를 병렬 실행
  → LLM 호출은 병렬, Git 작업은 직렬 큐로 충돌 방지
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

> **Phase 체크포인트**: 각 Phase 완료 시 체크포인트가 저장되어, 중단 시 `/resume`으로 해당 Phase부터 재개할 수 있습니다.

## 내부 아키텍처

### 핵심 구성요소

| 구성요소 | 역할 | 설명 |
|---------|------|------|
| **PipelineState** | 단일 상태 저장소 | 프로젝트/태스크/메시지/소집 기록을 명시적 필드로 관리 |
| **PromptAssembler** | 토큰 예산 맥락 조립 | 작업 유형별 필요 정보만 추출하여 LLM 프롬프트 구성 (코드베이스 맥락 포함) |
| **ResponseParser** | LLM 응답 구조화 파싱 | JSON 추출 + 키워드 폴백으로 판정(verdict) 추출 |
| **LocalWorkspace** | 로컬 Git 레포 연동 | 파일 탐색/읽기/쓰기 + git 브랜치/커밋/푸시 자동화 |
| **validateConnections** | 시작 시 연결 검증 | CLI 설치 → 인증 → GitHub 토큰/권한/스코프 확인을 실시간 표시 |

### PipelineState 필드 카탈로그

```
project.requirement     - 원본 요구사항 텍스트
project.title           - 프로젝트 제목 (워크스페이스에서 자동 파생)
kickoffSummary          - 킥오프 미팅 요약 (이후 에이전트 프롬프트에 주입)
designDecisions         - 설계 결정 사항
techStack               - 기술 스택
tasks[]                 - 분해된 태스크 목록 (코드/리뷰/QA 결과 포함)
completedTasks[]        - 완료된 태스크
messages[]              - 에이전트 간 전체 메시지
codebaseAnalysis        - Phase 0 코드베이스 분석 결과
completedPhases[]       - 완료된 Phase 체크포인트 (재개 시 활용)
github.kickoffIssue     - GitHub 킥오프 Issue 번호
github.designIssue      - GitHub 설계 Issue 번호
```

### PromptAssembler — Phase별 차등 토큰 예산

| Phase | 메서드 | 예산 | 이유 |
|-------|--------|------|------|
| 회의 | `forMeeting()` | 8,000자 | 이전 발언이 많아 균형 조절 |
| 코딩 | `forCoding()` | 12,000자 | 코드 품질 우선 (최대 예산) |
| 수정 | `forFix()` | 10,000자 | 피드백 + 설계 맥락 |
| 리뷰 | `forReview()` | 6,000자 | 코드는 별도 전달 |
| QA | `forQA()` | 4,000자 | 리뷰 결과만 필요 |
| 이미지 | `forImageGeneration()` | 6,000자 | 이미지 생성 프롬프트 |

### ResponseParser — LLM 응답 파싱

| 메서드 | 용도 | 반환 |
|--------|------|------|
| `parseTasks()` | Phase 3 태스크 분해 | 구조화된 태스크 배열 |
| `parseReviewVerdict()` | Phase 6 코드 리뷰 | APPROVED / CHANGES_REQUESTED |
| `parseQAVerdict()` | Phase 7 QA | PASS / FAIL |

### 프로젝트 구조

```
src/
├── index.js                    # CLI 엔트리포인트 (Commander.js) + dotenv 로드
├── i18n/
│   ├── index.js                # i18next 초기화 + t() 번역 함수
│   ├── detect-locale.js        # OS 로케일 자동 감지 (LC_ALL → LANG → Intl)
│   └── locales/
│       ├── en.json             # English
│       ├── ko.json             # 한국어
│       ├── ja.json             # 日本語
│       └── zh-CN.json          # 中文(简体)
├── config/
│   ├── loader.js               # YAML 설정 로더 (계층적 병합) + CLI/GitHub 연결 검증
│   ├── init.js                 # 대화형 설정 초기화 위저드 (글로벌/프로젝트)
│   ├── credentials.js          # 자격 증명 관리 (~/.polymeld/credentials.yaml)
│   ├── paths.js                # 크로스 플랫폼 경로 유틸리티
│   └── interaction.js          # 인터랙션 모드 관리
├── models/
│   ├── adapter.js              # CLI 추상화 (claude/gemini/codex) + thinking 매핑
│   └── response-parser.js      # LLM 응답 구조화 파싱
├── agents/
│   ├── agent.js                # 개별 에이전트 (페르소나)
│   └── team.js                 # 팀 관리자 ([PASS] 기반 자율 참여)
├── state/
│   ├── pipeline-state.js       # 단일 상태 저장소 (Phase 체크포인트 포함)
│   └── prompt-assembler.js     # Phase별 차등 토큰 예산 맥락 조립기
├── pipeline/
│   └── orchestrator.js         # 9-Phase 파이프라인 (Phase 0~8 + 병렬 실행 + 체크포인트)
├── workspace/
│   ├── local-workspace.js      # 로컬 Git 레포 (파일 탐색/읽기/쓰기 + git CLI)
│   └── noop-workspace.js       # 워크스페이스 미설정 시 No-op 클라이언트
├── repl/
│   ├── repl-shell.js           # REPL 루프 (상태 바 + 커맨드 메뉴)
│   ├── command-router.js       # 슬래시 명령어 라우팅 + Tab 자동완성
│   ├── status-bar.js           # 상태 바 렌더링
│   ├── paste-detect-stream.js  # Bracketed Paste Mode (멀티라인 입력)
│   └── commands/               # 슬래시 명령어 핸들러
│       ├── help.js
│       ├── status.js
│       ├── history.js
│       ├── context.js
│       ├── team.js
│       ├── resume.js
│       ├── save.js
│       └── load.js
├── session/
│   ├── session.js              # 세션 (PipelineState + 워크스페이스 + 실행 이력)
│   └── session-store.js        # 세션 디스크 저장/복원
└── github/
    └── client.js               # GitHub API (Issues, PRs, Projects) + 빈 레포 자동 초기화
test/
├── response-parser.test.js     # ResponseParser 단위 테스트 (다언어 키워드 매칭 포함)
├── pipeline-state.test.js      # PipelineState 단위 테스트
├── prompt-assembler.test.js    # PromptAssembler 단위 테스트
├── paste-detect-stream.test.js # Bracketed Paste Mode 테스트
├── i18n.test.js                # 번역 키 동기화 검증 (4개 언어 일치)
└── team.test.js                # Team 페르소나 정규화 테스트
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
node /path/to/polymeld/src/index.js run "요구사항" --no-interactive
```

또는 CLAUDE.md에 등록:
```markdown
## Polymeld
프로젝트 요구사항이 주어지면 Polymeld CLI를 실행하세요:
`node ./polymeld/src/index.js run "요구사항" --no-interactive`
```

## 페르소나 커스터마이징

설정 파일(`config.yaml`)에서 페르소나를 추가/수정할 수 있습니다:

```yaml
personas:
  devops:
    name: 최배포
    role: DevOps Engineer
    model: codex
    description: "CI/CD와 인프라 자동화에 집착. 배포 파이프라인의 완벽함을 추구."
    expertise:
      - CI/CD 파이프라인 구축
      - 컨테이너 오케스트레이션
      - 인프라 자동화

  concept_artist:
    name: 이컨셉
    role: Concept Artist
    model: gemini              # 토론/기획 시 텍스트 모델
    image_model: gemini_image  # 이미지 생성 시 이미지 모델
    description: "컨셉 아트와 비주얼 디자인 전문가"
    expertise:
      - 컨셉 아트 제작
      - 캐릭터/배경 디자인
```

> 모든 페르소나는 회의에 참여하되, 관련 없는 주제에서는 `[PASS]`로 자발적으로 패스합니다. 별도의 on_demand 설정은 필요 없습니다.

## 다국어 지원 (i18n)

CLI UI, AI 시스템 프롬프트, GitHub 코멘트 등 모든 텍스트가 4개 언어로 제공됩니다:

| 언어 | 코드 | 설정 방법 |
|------|------|----------|
| 한국어 | `ko` | `--lang ko` 또는 OS 로케일 |
| English | `en` | `--lang en` 또는 OS 로케일 |
| 日本語 | `ja` | `--lang ja` 또는 OS 로케일 |
| 中文(简体) | `zh-CN` | `--lang zh-CN` 또는 OS 로케일 |

**로케일 감지 우선순위**: `--lang` 플래그 → 환경변수 (`LC_ALL`, `LC_MESSAGES`, `LANG`) → `Intl` API → `en` (기본값)

AI 응답 파싱도 다국어 대응: 코드 리뷰 판정(`APPROVED`/`승인`/`承認`/`批准`), QA 판정(`PASS`/`합격`/`合格`/`通过`) 등을 언어에 무관하게 인식합니다.

## 라이선스

MIT
