🌐 [한국어](README.ko.md) | [English](README.md) | [日本語](README.ja.md) | [中文](README.zh-CN.md)

# Polymeld

**여러 AI 코딩 에이전트를 가상 개발팀으로 오케스트레이션합니다.**

Claude Code, Gemini CLI, Codex CLI를 각 페르소나에 배정하고, 회의 → 설계 → 개발 → 코드 리뷰 → QA → PR 생성까지 전 과정을 자동화합니다.

## ✨ 주요 특징

- **🤖 멀티 AI 팀** — 8명의 페르소나 (테크 리드, 프로그래머, QA, 디자이너 등)를 Claude, Gemini, Codex에 배정
- **🔄 8단계 파이프라인** — 코드베이스 분석 → 회의 → 태스크 분해 → 배정 → 개발 → 코드 리뷰 → QA → PR
- **🛠️ CLI + API 이중 백엔드** — 각 모델이 CLI 또는 API SDK로 동작 — 있는 것만 쓰거나 둘 다 가능
- **⚡ 병렬 개발** — 의존성을 분석하여 독립 태스크를 동시에 실행
- **🖼️ 이미지 생성** — 듀얼 엔진: Nano Banana 2 (Gemini) + GPT Image 1.5 (OpenAI) — 투명 배경 에셋은 GPT로 자동 라우팅
- **📂 로컬 워크스페이스** — 기존 코드를 읽고, 파일을 직접 생성하고, git 브랜치/커밋 자동 관리
- **🔁 자동 수정 루프** — 리뷰/QA 실패 시 자동 수정 → 재검증 사이클
- **💬 AI 회의** — 실시간 멀티 모델 토론, `[PASS]`/`[CONCLUDE]`로 자율 조절
- **📊 토큰 사용량 추적** — 매 작업마다 백엔드(CLI/API), 모델명, 토큰 수 표시
- **🔀 3단계 Rate Limit 폴백** — CLI → API key → fallback 모델 — rate limit 시 자동 전환
- **🌐 4개 언어 i18n** — English, 한국어, 日本語, 中文 완벽 지원
- **📌 GitHub 완전 추적** — 모든 과정이 Issues, Comments, Commits, PR로 기록

## 🚀 빠른 시작

```bash
# 1. Polymeld 설치
npm install -g polymeld

# 2. AI CLI 설치 (사용할 모델만)
npm install -g @anthropic-ai/claude-code   # Claude Code
npm install -g @google/gemini-cli           # Gemini CLI
npm install -g @openai/codex                # Codex CLI

# 3. 프로젝트 폴더에서 실행 — 온보딩 위저드가 자동 시작
cd ~/projects/my-app
polymeld
# → 모델 선택 → GitHub 토큰 설정 → 완료!
# → GITHUB_REPO는 git remote에서 자동 감지
```

## 📋 명령어

| 명령어 | 설명 |
|--------|------|
| `polymeld` | REPL 시작 (첫 실행 시 온보딩 위저드) |
| `polymeld run "요구사항"` | 전체 파이프라인 실행 |
| `polymeld run "요구사항" --mode semi-auto` | Phase마다 확인 |
| `polymeld meeting "주제"` | 미팅만 실행 |
| `polymeld start --resume` | 이전 세션 재개 |
| `polymeld test-models` | 모델 연결 테스트 |
| `polymeld init --global` | 글로벌 설정 초기화 |
| `polymeld auth` | 자격 증명 대화형 관리 |

**REPL 슬래시 명령어:** `/help` `/status` `/history` `/context` `/team` `/mode` `/resume` `/save` `/load` `/exit`

## ⚙️ 파이프라인

```
Phase 0  코드베이스 분석       기존 코드 구조 분석 (로컬 워크스페이스 시)
Phase 1  미팅                 멀티 AI 토론 → 설계 결정
Phase 2  태스크 분해           1-4시간 단위로 분해 → GitHub Issues
Phase 3  작업 배정             태스크를 적합한 페르소나에 배정
Phase 4  개발                 병렬 코딩 → feature 브랜치 → 커밋
Phase 5  코드 리뷰             팀장 리뷰 → 자동 수정 → 재리뷰 (×3)
Phase 6  QA                   검증 → 자동 수정 → 재검증 (×3)
Phase 7  PR 생성               모든 이력이 링크된 PR 자동 생성
```

> **체크포인트**: 각 Phase 완료 시 저장되어, `/resume`으로 해당 Phase부터 재개 가능.

## 📌 GitHub Issue & 칸반 보드

Polymeld는 **GitHub Issues**와 **GitHub Projects V2** 칸반 보드를 활용하여 파이프라인 전 과정을 자동 추적합니다.

### 이슈 자동 생성

| Phase | 생성되는 이슈 | 라벨 |
|-------|-------------|------|
| Phase 1 | 📝 **Planning Issue** — 회의 결과 기록 | `meeting-notes`, `planning`, `polymeld` |
| Phase 2 | 🔧 **Task Issue** — 분해된 각 태스크별 1개 | `backlog`, `polymeld`, `{{category}}` |

### 칸반 6단계 칼럼

파이프라인 진행에 따라 이슈가 칸반 보드의 칼럼을 자동 이동합니다:

```
Backlog → Todo → In Progress → In Review → QA → Done
```

| 칼럼 | 전환 시점 | 라벨 변경 |
|------|----------|----------|
| **Backlog** | Phase 2: 태스크 분해 후 | `backlog` |
| **Todo** | Phase 3: 페르소나에 배정 | `todo`, `assigned:{{agent}}` |
| **In Progress** | Phase 4: 개발 시작 | `in-progress` |
| **In Review** | Phase 5: 코드 리뷰 진행 | `in-review` |
| **QA** | Phase 6: QA 진행 | `qa` |
| **Done** | Phase 6: QA 통과 → Issue 자동 종료 | `done` |

### 자동 코멘트

각 Phase 전환 시 이슈에 코멘트가 자동 추가되어 전체 이력을 추적합니다:

- 🧑‍💼 **작업 배정** — 담당자, 배정 사유
- 🚀 **개발 시작/완료** — 에이전트명, 모델, 코드 미리보기
- 🔍 **코드 리뷰** — 리뷰 결과 (시도 횟수 포함)
- 🧪 **QA 결과** — 검증 결과, 피드백 기반 수정 이력

### PR과 Issue 연결

Phase 7에서 생성되는 PR은 완료된 모든 Task Issue를 `Closes #N`으로 참조하여, PR 머지 시 관련 이슈가 자동 종료됩니다.

> GitHub 토큰 없이도 파이프라인 실행은 가능합니다. GitHub 기능만 비활성화됩니다.

## 👥 기본 팀 구성

| 페르소나 | 역할 | 모델 | 이미지 |
|---------|------|------|--------|
| 김아키 | Tech Lead (팀장) | Claude Opus 4.6 | — |
| 한코딩 | Ace Programmer | GPT-5.4 | — |
| 류창작 | Creative Programmer | Gemini 3.1 Pro | — |
| 강기획 | Ace Planner | Gemini 3.1 Pro | — |
| 안보안 | Security Expert | Claude Opus 4.6 | — |
| 윤경험 | UX/Visual Designer | Gemini 3.1 Pro | Nano Banana 2 / GPT Image 1.5 |
| 그림솔 | Illustrator | Gemini 3.1 Pro | Nano Banana 2 / GPT Image 1.5 |
| 정테스트 | QA Engineer | GPT-5.4 | — |

> 모든 페르소나가 회의에 참여. `[PASS]`(건너뜀)와 `[CONCLUDE]`(조기 종료)로 자율 조절.

## 🔧 설정

### 백엔드 우선순위

각 모델은 자동으로 전환되는 **두 가지 백엔드**를 지원합니다:

| 우선순위 | 백엔드 | 사용 조건 |
|---------|--------|----------|
| 1순위 | **CLI** (claude / gemini / codex) | 설치되어 있고 사용 가능할 때 |
| 2순위 | **API SDK** (Anthropic / Google GenAI / OpenAI) | CLI rate limit 또는 CLI 미설치 시 |
| 3순위 | **Fallback 모델** | CLI와 API 모두 rate limit 시 |

> CLI만, API만, 또는 둘 다 — 있는 것만으로 동작합니다. `api_model`로 API 호출에 다른 모델을 지정할 수 있습니다.

### 자격 증명

```bash
polymeld auth                  # 대화형 설정
polymeld auth --show           # 현재 상태 확인
```

또는 `.env` / `~/.polymeld/credentials.yaml` 사용:

```bash
GITHUB_TOKEN=ghp_xxxxx        # 필수
# GITHUB_REPO=owner/repo      # git remote에서 자동 감지

# API 키 (선택 — 프로바이더별 API 백엔드 활성화)
ANTHROPIC_API_KEY=sk-...       # Claude API
GOOGLE_API_KEY=AIzaSy...       # Gemini API (Nano Banana 2 이미지 생성)
OPENAI_API_KEY=sk-...          # OpenAI API (GPT Image 1.5 투명 PNG 생성)
```

### config.yaml

설정 파일은 계층적으로 병합됩니다: `-c` 플래그 > `~/.polymeld/config.yaml` (글로벌) > `.polymeld/config.yaml` (프로젝트) > `.polymeld/config.local.yaml` (로컬).

```yaml
# 모델 정의
models:
  claude:
    cli: claude
    model: claude-opus-4-6
    fallback: gemini             # rate limit 시 전환
  gemini:
    cli: gemini
    model: gemini-3.1-pro-preview
    fallback: claude
  codex:
    cli: codex
    model: gpt-5.4
    fallback: claude
  gemini_image:
    cli: gemini
    model: gemini-3.1-flash-image-preview  # Nano Banana 2 (GOOGLE_API_KEY 필수)
  gpt_image:
    cli: codex
    model: gpt-image-1.5                   # 투명 PNG (OPENAI_API_KEY 필수)

# 페르소나 배정
personas:
  tech_lead:
    name: 김아키
    model: claude
    thinking_budget: 50          # AI 사고 깊이 (0-100)
  designer:
    name: 윤경험
    model: gemini
    image_model: gemini_image    # 이미지 생성 활성화

# 파이프라인 설정
pipeline:
  parallel_development: true     # 병렬 LLM 호출
  thinking_budget: 25            # 전역 기본값 (0-100)
  max_review_retries: 3
  max_qa_retries: 3
```

### 커스텀 페르소나

```yaml
personas:
  devops:
    name: 최배포
    role: DevOps Engineer
    model: codex
    description: "CI/CD와 인프라 자동화에 집착하는 배포 전문가"
    expertise:
      - CI/CD 파이프라인 구축
      - 컨테이너 오케스트레이션
```

## 🌐 다국어 지원

| 언어 | 플래그 | 자동 감지 |
|------|--------|----------|
| English | `--lang en` | OS 로케일 |
| 한국어 | `--lang ko` | OS 로케일 |
| 日本語 | `--lang ja` | OS 로케일 |
| 中文(简体) | `--lang zh-CN` | OS 로케일 |

AI 응답 파싱도 다국어 대응 — `APPROVED`/`승인`/`承認`/`批准` 등의 판정을 언어에 무관하게 인식합니다.

## Claude Code 연동

```bash
polymeld run "요구사항" --no-interactive
```

`CLAUDE.md`에 등록하면 자동 호출도 가능합니다.

## 🧠 에이전트 통신 아키텍처

에이전트들은 서로 직접 대화하지 않습니다. 모든 통신은 **PipelineState**(공유 상태)와 **PromptAssembler**(맥락 중재자)를 통해 이루어집니다.

### 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                     PipelineState                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │ messages  │ │  tasks   │ │  design  │ │ codebase  │  │
│  │   []      │ │   []     │ │ Decisions│ │ Analysis  │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘  │
└────────────────────┬────────────────────────────────────┘
                     │ read
              ┌──────┴──────┐
              │   Prompt    │  토큰 예산 내에서
              │  Assembler  │  관련 맥락만 선별
              └──────┬──────┘
          ┌──────────┼──────────┐
          ▼          ▼          ▼
     ┌─────────┐ ┌─────────┐ ┌─────────┐
     │ 테크리드 │ │ 개발자  │ │   QA    │
     │ (Claude)│ │(Gemini) │ │(Codex)  │
     └────┬────┘ └────┬────┘ └────┬────┘
          │ write      │ write     │ write
          └────────────┴───────────┘
                       │
              PipelineState로 기록
```

### 통신 패턴

| 패턴 | 흐름 | 설명 |
|------|------|------|
| **회의 발언** | 에이전트 → `messages[]` → 다음 에이전트 | 라운드 로빈 토론, 이전 발언을 보고 응답 |
| **설계 → 코드** | `designDecisions` → 개발자 | 회의 결과가 코딩 맥락으로 전달 |
| **코드 → 리뷰** | `task.code` → 테크리드 | 작성된 코드가 리뷰어에게 전달 |
| **리뷰 → 수정** | `task.review` → 개발자 | 리뷰 피드백이 수정 사이클 촉발 |
| **QA → 수정** | `task.qa` → 테크리드 | QA 실패 시 팀장이 직접 수정 |

### 메시지 흐름 예시

```
Phase 1 — 회의
  Archie 발언 → 메시지 저장 → Nova가 읽고 → 발언 → ...
  최종 산출물: designDecisions, techStack

Phase 4 — 개발
  PromptAssembler.forCoding()
    → designDecisions (30%)
    → codebaseAnalysis (50%)      ← 토큰 예산 배분
    → techStack (나머지)
  개발자 코드 작성 → task.code + task.filePaths

Phase 5–6 — 리뷰 & QA 수정 사이클
  Lead.reviewCode(task.code)
    → 판정: "approved" | "changes_requested"
    → changes_requested → Lead.writeCode(리뷰 + 코드)
  QA.runQA(task.filePaths)
    → 판정: "pass" | "fail"
    → fail → Lead.writeCode(QA결과 + 코드) → 재QA (최대 ×3)
```

> 각 에이전트는 PromptAssembler가 제공하는 맥락만 볼 수 있으며, 전체 상태에 직접 접근하지 않습니다. 이를 통해 프롬프트를 집중적이고 모델 컨텍스트 한도 내로 유지합니다.

## 라이선스

MIT
