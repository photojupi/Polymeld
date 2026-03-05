# 🤖 Agent Team CLI

**멀티 AI 모델 기반 개발팀 시뮬레이션**

Claude Code, Gemini CLI, Codex CLI를 각 페르소나(팀장, 백엔드, 프론트엔드, DevOps, QA)에 배정하고,
회의 → 설계 → 개발 → 리뷰 → QA → PR 생성까지 자동화합니다.

## 아키텍처

```
┌─────────────────────────────────────────────────┐
│                 Agent Team CLI                   │
│              (Node.js 오케스트레이터)              │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │  Claude   │  │ Gemini   │  │ Codex    │      │
│  │  Code CLI │  │ CLI      │  │ CLI      │      │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘      │
│       │              │              │            │
│  ┌────▼─────┐  ┌────▼─────┐  ┌────▼─────┐      │
│  │ 김아키    │  │ 이서버    │  │ 정테스트  │      │
│  │ (팀장)    │  │ (백엔드)  │  │ (QA)     │      │
│  └──────────┘  │ 박유아이   │  │ 최배포    │      │
│                │ (프론트)   │  │ (DevOps) │      │
│                └──────────┘  └──────────┘      │
│                                                  │
├─────────────────────────────────────────────────┤
│              GitHub Integration                  │
│  Issues │ Comments │ Projects │ Branches │ PRs   │
└─────────────────────────────────────────────────┘
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

페르소나별 모델 배정을 자유롭게 변경할 수 있습니다:

```yaml
personas:
  tech_lead:
    name: 김아키
    model: claude          # 팀장은 Claude Code
  backend_dev:
    name: 이서버
    model: gemini          # 백엔드는 Gemini CLI
  frontend_dev:
    name: 박유아이
    model: gemini          # 프론트도 Gemini CLI
  devops:
    name: 최배포
    model: codex           # DevOps는 Codex CLI
  qa:
    name: 정테스트
    model: codex           # QA도 Codex CLI
```

**조합 예시:**

| 구성 | 팀장 | 백엔드 | 프론트 | DevOps | QA |
|------|------|--------|--------|--------|-----|
| 풀 멀티 | Claude | Gemini | Gemini | Codex | Codex |
| Claude 중심 | Claude | Claude | Claude | Claude | Codex |
| 비용 절약 | Gemini | Gemini | Gemini | Gemini | Gemini |
| 고품질 | Claude | Claude | Gemini | Codex | Claude |

## 사용법

### 전체 파이프라인 실행
```bash
# 대화형 모드 (각 Phase마다 확인)
node src/index.js run "실시간 채팅 기능 구현"

# 비대화형 모드 (자동 진행)
node src/index.js run "실시간 채팅 기능 구현" --no-interactive

# 프로젝트 제목 지정
node src/index.js run "채팅 기능" --title "실시간 채팅 v1.0"
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

## 파이프라인 상세

```
Phase 1: 킥오프 미팅
  → 5명의 페르소나가 각자의 AI 모델로 의견 제시
  → 회의록이 GitHub Issue에 자동 등록

Phase 2: 기술 설계 미팅
  → 페르소나 간 의견 충돌/합의 시뮬레이션
  → 서로 다른 모델이 서로 다른 관점으로 토론
  → 설계 결정 문서가 GitHub Issue에 등록

Phase 3: 태스크 분해
  → 팀장(Claude)이 1-4시간 단위로 태스크 분해
  → 각 태스크가 GitHub Issue로 생성 (backlog 라벨)

Phase 4: 작업 분배
  → 팀장이 각 태스크를 적합한 페르소나에게 배정
  → 배정 이유가 Issue Comment로 기록

Phase 5: 개발
  → 각 페르소나가 자신의 AI 모델로 코드 작성
  → feature 브랜치에 커밋
  → 진행 상황이 Issue Comment로 업데이트

Phase 6: 코드 리뷰
  → 팀장(Claude)이 다른 모델이 작성한 코드를 리뷰
  → 리뷰 결과가 Issue Comment로 기록

Phase 7: QA
  → QA(Codex)가 코드 검증
  → 테스트 결과가 Issue Comment에 표 형태로 기록

Phase 8: PR 생성
  → 모든 이력(회의록, 리뷰, QA)이 링크된 PR 자동 생성
```

## GitHub에 기록되는 항목

모든 과정이 GitHub에 추적 가능하게 기록됩니다:

- **회의록**: Issue (meeting-notes 라벨)
- **태스크**: Issue (backlog → todo → in-progress → done)
- **배정 기록**: Issue Comment
- **개발 로그**: Issue Comment + Commit
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
\`node ./agent-team-cli/src/index.js run "요구사항" --no-interactive\`
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
```

## 라이선스

MIT
