🌐 [한국어](README.ko.md) | [English](README.md) | [日本語](README.ja.md) | [中文](README.zh-CN.md)

# Polymeld

**여러 AI 코딩 에이전트를 가상 개발팀으로 오케스트레이션합니다.**

Claude Code, Gemini CLI, Codex CLI를 각 페르소나에 배정하고, 회의 → 설계 → 개발 → 코드 리뷰 → QA → PR 생성까지 전 과정을 자동화합니다.

## ✨ 주요 특징

- **🤖 멀티 AI 팀** — 8명의 페르소나 (테크 리드, 프로그래머, QA, 디자이너 등)를 Claude, Gemini, Codex에 배정
- **🔄 8단계 파이프라인** — 코드베이스 분석 → 회의 → 태스크 분해 → 배정 → 개발 → 코드 리뷰 → QA → PR
- **⚡ 병렬 개발** — 의존성을 분석하여 독립 태스크를 동시에 실행
- **🖼️ 이미지 생성** — `image_model` 설정 시 Nano Banana 2로 이미지 자동 생성
- **📂 로컬 워크스페이스** — 기존 코드를 읽고, 파일을 직접 생성하고, git 브랜치/커밋 자동 관리
- **🔁 자동 수정 루프** — 리뷰/QA 실패 시 자동 수정 → 재검증 사이클
- **💬 AI 회의** — 실시간 멀티 모델 토론, `[PASS]`/`[CONCLUDE]`로 자율 조절
- **🔀 Rate Limit 폴백** — CLI → API → fallback 모델 — 3단계 자동 전환
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
| `polymeld meeting kickoff "주제"` | 킥오프 미팅만 실행 |
| `polymeld meeting design "주제" --rounds 3` | N 라운드 설계 미팅 |
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

## 👥 기본 팀 구성

| 페르소나 | 역할 | 모델 | 이미지 |
|---------|------|------|--------|
| 김아키 | Tech Lead (팀장) | Claude Opus 4.6 | — |
| 한코딩 | Ace Programmer | GPT-5.4 | — |
| 류창작 | Creative Programmer | Gemini 3.1 Pro | — |
| 강기획 | Ace Planner | Gemini 3.1 Pro | — |
| 안보안 | Security Expert | Claude Opus 4.6 | — |
| 윤경험 | UX/Visual Designer | Gemini 3.1 Pro | Nano Banana 2 |
| 그림솔 | Illustrator | Gemini 3.1 Pro | Nano Banana 2 |
| 정테스트 | QA Engineer | GPT-5.4 | — |

> 모든 페르소나가 회의에 참여. `[PASS]`(건너뜀)와 `[CONCLUDE]`(조기 종료)로 자율 조절.

## 🔧 설정

### 자격 증명

```bash
polymeld auth                  # 대화형 설정
polymeld auth --show           # 현재 상태 확인
```

또는 `.env` / `~/.polymeld/credentials.yaml` 사용:

```bash
GITHUB_TOKEN=ghp_xxxxx        # 필수
# GITHUB_REPO=owner/repo      # git remote에서 자동 감지
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
    model: gemini-3.1-flash-image  # Nano Banana 2

# 페르소나 배정
personas:
  tech_lead:
    name: 김아키
    model: claude
    thinking_budget: 100         # AI 사고 깊이 (0-100)
  designer:
    name: 윤경험
    model: gemini
    image_model: gemini_image    # 이미지 생성 활성화

# 파이프라인 설정
pipeline:
  parallel_development: true     # 병렬 LLM 호출
  thinking_budget: 50            # 전역 기본값 (0-100)
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

## 라이선스

MIT
