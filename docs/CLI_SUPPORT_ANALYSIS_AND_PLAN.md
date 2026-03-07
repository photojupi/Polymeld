# Polymeld - 3종 CLI 지원 현황 심층 분석 및 구현 계획서

**작성일**: 2026-03-06
**작성자**: 시니어 아키텍트
**대상 파일**: `src/models/adapter.js` (핵심), `src/config/loader.js`, `polymeld.config.yaml`
**버전**: v0.1.0 기반 분석

---

## 목차

1. [현황 분석](#1-현황-분석)
2. [각 CLI 최신 사양](#2-각-cli-최신-사양)
3. [개선 사항 목록](#3-개선-사항-목록)
4. [구현 계획](#4-구현-계획)
5. [리스크 분석](#5-리스크-분석)

---

## 1. 현황 분석

### 1.1 프로젝트 구조 개요

```
src/
├── models/adapter.js      ← 3종 CLI 추상화 계층 (분석 핵심)
├── agents/agent.js         ← 페르소나별 에이전트 (adapter.chat() 호출)
├── agents/team.js          ← 팀 오케스트레이션
├── pipeline/orchestrator.js ← 8-Phase 파이프라인
├── config/loader.js        ← 설정 로드 + CLI 존재 검증
├── config/interaction.js   ← 사용자 인터랙션 모드 관리
├── github/client.js        ← GitHub API 연동
└── index.js                ← CLI 진입점
```

### 1.2 현재 adapter.js 호출 방식 요약

| CLI | 메서드 | 호출 방식 | 입력 전달 | 시스템 프롬프트 |
|-----|--------|-----------|-----------|----------------|
| Claude Code | `_chatClaude()` | `_spawnCli("claude", args, stdinData)` | stdin | `--system-prompt` 플래그 |
| Gemini CLI | `_chatGemini()` | `_spawnShellCmd(cmdString)` | 셸 명령어 인수 (`-p "escaped"`) | `_buildCombinedPrompt()`로 합침 |
| Codex CLI | `_chatCodex()` | `_spawnCli("codex", args, stdinData)` | stdin (`-` 플래그) | `_buildCombinedPrompt()`로 합침 |

### 1.3 확인된 문제점

#### [치명적] P0: 보안/안정성

**P0-1. Gemini CLI 셸 인젝션 취약점**
```javascript
// 현재 코드 (adapter.js L128)
const escaped = prompt.replace(/"/g, '\\"');
let cmd = `gemini -p "${escaped}"`;
```
- 큰따옴표(`"`)만 이스케이프하고 있음
- **누락된 이스케이프 대상**: 백틱(`` ` ``), 달러 기호(`$`), 백슬래시(`\`), 느낌표(`!`), 개행문자(`\n`)
- 프롬프트에 `` `rm -rf /` `` 또는 `$(malicious_command)` 포함 시 셸 명령어 실행 가능
- 특히 사용자 입력이 프롬프트에 포함되는 `speak()`, `writeCode()` 등에서 위험

**P0-2. 타임아웃 미처리**
```javascript
// 현재 _spawnCli() - 타임아웃 없음
const proc = spawn(command, args, { ... });
// AI 모델 응답 지연 시 프로세스가 무한 대기
```
- AI CLI 호출은 응답 시간이 수십 초에서 수 분까지 가능
- 네트워크 장애 시 영원히 대기하는 프로세스가 생길 수 있음
- 파이프라인의 8개 Phase 각각에서 다수의 CLI 호출이 발생하므로 누적 리스크가 큼

**P0-3. Gemini CLI stdin 미지원이라는 잘못된 전제**
```javascript
// adapter.js L49-51 주석
// Gemini CLI처럼 stdin을 지원하지 않고 인수로 프롬프트를 받는 경우 사용.
```
- **최신 Gemini CLI (v0.28+)는 stdin/pipe 입력을 정식 지원함**
- `echo "prompt" | gemini` 또는 `cat file.txt | gemini` 방식으로 입력 가능
- 현재의 셸 문자열 방식은 불필요한 복잡성과 보안 리스크를 유발

#### [중요] P1: 기능/호환성

**P1-1. Codex CLI `exec` 모드 인수 불일치**
```javascript
// 현재 코드 (adapter.js L143)
const args = ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "-"];
```
- `-` (stdin 읽기)가 `codex exec`의 공식 문서에서 명시적으로 확인되지 않음
- 최신 Codex CLI에서 `codex exec "prompt"` 형태의 위치 인수(positional argument)가 정식 지원됨
- `--json` 플래그로 구조화된 JSONL 출력을 받을 수 있으나 현재 미활용
- `--ask-for-approval never` 또는 `-q` (quiet) 플래그가 비대화형 자동화에 더 적합

**P1-2. 출력 포맷 정규화 부재**
- Claude: `--output-format text`로 순수 텍스트 수신
- Gemini: 기본 텍스트 출력 (별도 포맷 지정 없음)
- Codex: 기본 텍스트 출력 (`--json`으로 JSONL 가능하나 미사용)
- 세 CLI의 출력에서 마크다운 코드블록, ANSI 색상코드, 진행률 표시 등의 잡음이 혼재할 수 있음
- `orchestrator.js`에서 JSON 파싱 시 실패하는 원인이 될 수 있음 (L239-246)

**P1-3. 에러 메시지의 비일관성**
```javascript
// _spawnCli (L35-36)
reject(new Error(`CLI 오류 (${command}, exit ${code}): ${stderr || stdout}`));
// _spawnShellCmd (L68-69)
reject(new Error(`CLI 오류 (exit ${code}): ${stderr || stdout}`));
```
- `_spawnShellCmd`에서는 command 이름이 누락됨
- 에러 발생 시 어떤 CLI에서 실패했는지 즉시 파악 어려움
- 종료 코드별 의미가 CLI마다 다르나 일괄적으로 처리 중

**P1-4. Windows 환경 호환성 문제**
- `shell: true`로 Windows .cmd 파일 호출은 가능하나 셸 이스케이핑 규칙이 다름
- Gemini의 `_spawnShellCmd` 방식에서 Windows `cmd.exe`는 Unix 셸과 다른 이스케이핑 필요
- `"` → `\"` 이스케이프가 PowerShell에서는 작동하지 않을 수 있음 (`` `" `` 필요)

#### [개선] P2: 확장성/유지보수

**P2-1. `_spawnShellCmd`의 존재 자체가 아키텍처 부채**
- Gemini CLI가 stdin을 지원하게 되면서 `_spawnShellCmd` 메서드의 존재 이유가 사라짐
- 두 가지 실행 경로(`_spawnCli` vs `_spawnShellCmd`)가 유지보수 비용을 높임

**P2-2. 새 CLI 추가 시 확장성 부족**
- 새로운 AI CLI(예: Cursor CLI, Aider 등) 추가 시 `switch-case`에 분기 추가 필요
- CLI별 특성(입력 방식, 시스템 프롬프트 처리 등)이 어댑터에 직접 하드코딩됨
- 전략 패턴(Strategy Pattern) 또는 플러그인 아키텍처로의 전환이 바람직

**P2-3. 모델별 설정 옵션 부족**
- `config.yaml`에서 CLI별 추가 옵션(타임아웃, 최대 토큰, 온도 등)을 지정할 수 없음
- 모든 CLI 호출이 동일한 설정으로 실행됨

**P2-4. CLI 버전 검증 없음**
- CLI 존재 여부(`which`/`where`)만 확인하고 버전 호환성은 미검증
- 구버전 CLI에서 최신 플래그 사용 시 무조건 실패

---

## 2. 각 CLI 최신 사양

### 2.1 Claude Code CLI

**설치**: `npm install -g @anthropic-ai/claude-code`
**최신 버전 확인**: `claude --version`, `claude doctor`

#### 비대화형 모드 플래그

| 플래그 | 설명 | 비고 |
|--------|------|------|
| `-p`, `--print` | 비대화형(headless) 원샷 모드 | 필수 |
| `--output-format text\|json\|stream-json` | 출력 포맷 지정 | `json` 권장 (자동화) |
| `--system-prompt <text>` | 시스템 프롬프트 지정 | 네이티브 지원 |
| `--model <id>` | 모델 선택 | 예: `claude-sonnet-4-20250514` |
| `--max-turns <N>` | 에이전트 턴 제한 | 무한 루프 방지 |
| `--allowedTools <tools...>` | 사용 가능 도구 화이트리스트 | 공백 구분 |
| `--disallowedTools <tools...>` | 도구 블랙리스트 | deny 우선 |
| `--input-format text\|stream-json` | 입력 포맷 (stdin) | 에이전트 체이닝용 |
| `--no-session-persistence` | 세션 저장 안 함 | 자동화 시 권장 |
| `--` | 플래그 종료 마커 | 이후 텍스트를 프롬프트로 처리 |

#### 입력 방식
- **stdin 지원**: `echo "prompt" | claude -p`
- **인수 방식**: `claude -p "직접 프롬프트"`
- **파일 방식**: 리다이렉션 가능 (`claude -p < prompt.txt`)

#### 출력 포맷 상세
- `text`: 순수 텍스트 (기본값)
- `json`: 완전한 JSON 객체 (`{ result, usage: { output_tokens } }`)
- `stream-json`: NDJSON (줄 단위 JSON 이벤트, 실시간 처리용)

#### 환경 변수
| 변수 | 용도 |
|------|------|
| `ANTHROPIC_API_KEY` | API 키 |
| `ANTHROPIC_MODEL` | 기본 모델 |
| `BASH_DEFAULT_TIMEOUT_MS` | Bash 도구 타임아웃 (기본 120000) |
| `BASH_MAX_TIMEOUT_MS` | Bash 최대 타임아웃 |
| `MCP_TIMEOUT` | MCP 서버 타임아웃 |

#### 종료 코드
| 코드 | 의미 |
|------|------|
| 0 | 성공 |
| 1 | 일반 런타임 에러 |
| 2 | 차단 에러 (stderr가 Claude에 피드백) |

#### 권장 호출 패턴 (자동화)
```bash
claude -p \
  --output-format json \
  --system-prompt "시스템 프롬프트" \
  --model claude-sonnet-4-20250514 \
  --max-turns 3 \
  -- "사용자 프롬프트"
```

---

### 2.2 Gemini CLI

**설치**: `npm install -g @google/gemini-cli`
**최신 버전 확인**: `/about` 명령어 (대화형 내부)

#### 비대화형 모드 플래그

| 플래그 | 설명 | 비고 |
|--------|------|------|
| `-p`, `--prompt` | 비대화형(headless) 모드 진입 | 필수 |
| `-m`, `--model <id>` | 모델 선택 (기본: `auto`) | 예: `gemini-2.5-flash` |
| `--output-format text\|json\|stream-json` | 출력 포맷 | `json` 권장 |
| `--sandbox`, `-s` | 샌드박스 모드 | |
| `--approval-mode default\|auto_edit\|yolo` | 도구 승인 모드 | `--yolo` deprecated |
| `--debug`, `-d` | 디버그 출력 | |
| `--proxy <url>` | 프록시 설정 | |

#### 입력 방식 (핵심 변경사항)
- **stdin/pipe 지원 확인됨**: `echo "prompt" | gemini` 또는 `cat file.txt | gemini`
- **-p 플래그**: `gemini -p "프롬프트"` (따옴표 처리 필요)
- `-i` / `--prompt-interactive`는 stdin과 동시 사용 불가 (대화형 전용)

#### 출력 포맷 상세
- `text`: 사람이 읽기 좋은 텍스트 (기본값)
- `json`: 구조화된 JSON (`{ response, stats: { session, model, tools, user }, error: { type, message, code } }`)
- `stream-json`: NDJSON 스트리밍

#### 시스템 프롬프트 처리
- **전용 CLI 플래그 없음** (공식 문서에서 `--system` 등의 플래그 미확인)
- `settings.json`의 설정이나 프로젝트 컨텍스트로 간접 주입 가능
- 현재의 `_buildCombinedPrompt()` 방식 유지 필요

#### 모델 라우팅
- `auto` 선택 시 자동 라우팅 및 폴백 (예: `flash-lite` -> `flash` -> `pro`)
- 우선순위: `--model` CLI 플래그 > `GEMINI_MODEL` 환경 변수 > `settings.json` > 자동

#### 환경 변수
| 변수 | 용도 |
|------|------|
| `GEMINI_API_KEY` | API 키 (우선) |
| `GOOGLE_API_KEY` | API 키 (대체) |
| `GEMINI_MODEL` | 기본 모델 |
| `GOOGLE_GENAI_USE_VERTEXAI` | Vertex AI 사용 |
| `NO_COLOR` | 색상 비활성화 |

#### 종료 코드
| 코드 | 의미 |
|------|------|
| 0 | 성공 |
| 41 | 인증 실패 (FatalAuthenticationError) |
| 42 | 입력 오류 (FatalInputError) |
| 44 | 샌드박스 오류 (FatalSandboxError) |
| 52 | 설정 오류 (FatalConfigError) |
| 53 | 턴 제한 도달 (FatalTurnLimitedError) |

#### 권장 호출 패턴 (자동화) - **변경 전/후 비교**
```bash
# [변경 전] 현재 코드의 방식 - 보안 취약
gemini -p "이스케이프_불완전한_프롬프트" -m gemini-2.5-flash

# [변경 후] stdin 파이프 방식 - 안전
echo "프롬프트" | gemini --output-format json -m gemini-2.5-flash
# 또는
gemini -m gemini-2.5-flash --output-format json <<'EOF'
여기에 안전하게 프롬프트 입력
EOF
```

---

### 2.3 Codex CLI

**설치**: `npm install -g @openai/codex`
**최신 버전 확인**: `codex --version`

#### 비대화형 모드 (`codex exec`)

| 플래그 | 설명 | 비고 |
|--------|------|------|
| `exec` | 비대화형 실행 서브커맨드 | 필수 |
| `--sandbox read-only\|workspace-write\|danger-full-access` | 샌드박스 모드 | |
| `-m`, `--model <id>` | 모델 선택 | 예: `o4-mini`, `gpt-5.3-codex` |
| `--json` | JSONL 스트리밍 출력 | 자동화 권장 |
| `-o <file>` | 최종 어시스턴트 메시지를 파일로 저장 | |
| `-q`, `--quiet` | UI 비활성화, 추론 단계를 JSON으로 출력 | |
| `--skip-git-repo-check` | Git 저장소 검사 우회 | 필수 (임의 디렉토리) |
| `--ask-for-approval on-request\|never\|untrusted` | 승인 모드 | `never` 권장 (자동화) |
| `--full-auto` | 저마찰 승인 + workspace-write 강제 | `--sandbox` 오버라이드 주의 |

#### 입력 방식
- **위치 인수**: `codex exec "프롬프트 텍스트"` (공식 지원)
- **stdin 파이프**: `git log | codex -p` (예시 존재)
- **`-` 파일명**: 공식 문서에서 명시적 확인 안 됨 (현재 코드에서 사용 중 -- 리스크)

#### 출력 포맷 상세
- 기본: TUI 포맷된 텍스트/diff/코드블록
- `--json`: NDJSON 이벤트 스트림 (추론 단계 포함)
- `-o`: 최종 메시지만 파일로 추출

#### 시스템 프롬프트 처리
- **`codex exec` 위치 인수가 초기 지시(instruction) 역할**
- `~/.codex/config.toml`에서 `model_instructions_file` 키로 지시 파일 지정 가능
- 전용 `--system-prompt` 플래그는 없음
- 현재의 `_buildCombinedPrompt()` 방식 유지 필요

#### 환경 변수
| 변수 | 용도 |
|------|------|
| `OPENAI_API_KEY` | API 키 (일반) |
| `CODEX_API_KEY` | API 키 (exec 전용) |
| `CODEX_QUIET_MODE=1` | 조용한 모드 |

#### 종료 코드
- 공식 문서에서 세분화된 종료 코드 매핑이 없음
- 비정상 종료 시 0이 아닌 코드 반환
- 자식 명령 비정상 종료 시 stdout/stderr가 억제될 수 있음 (주의)

#### 권장 호출 패턴 (자동화) - **변경 전/후 비교**
```bash
# [변경 전] 현재 코드의 방식 - `-` 규약 미확인
codex exec --sandbox read-only --skip-git-repo-check -

# [변경 후] 위치 인수 + 추가 플래그
codex exec \
  --sandbox read-only \
  --skip-git-repo-check \
  -q \
  "프롬프트 텍스트"
```

---

## 3. 개선 사항 목록

### P0 (즉시 수정 필요 - 보안/안정성)

| ID | 제목 | 현재 상태 | 대상 파일 | 예상 공수 |
|----|------|-----------|-----------|-----------|
| P0-1 | Gemini CLI를 stdin 방식으로 전환 | 셸 문자열 방식 (인젝션 취약) | `adapter.js` | 2h |
| P0-2 | CLI 호출 타임아웃 구현 | 타임아웃 없음 | `adapter.js` | 3h |
| P0-3 | `_spawnShellCmd` 제거 | 불필요한 보안 리스크 | `adapter.js` | 1h (P0-1과 병행) |

### P1 (1주 이내 수정 - 기능/호환성)

| ID | 제목 | 현재 상태 | 대상 파일 | 예상 공수 |
|----|------|-----------|-----------|-----------|
| P1-1 | Codex CLI `exec` 모드 호출 방식 정정 | `-` 규약 미확인 | `adapter.js` | 2h |
| P1-2 | 출력 포맷 정규화 레이어 추가 | 잡음(ANSI, 마크다운) 혼재 | `adapter.js` | 3h |
| P1-3 | 에러 핸들링 통합 및 종료 코드별 분류 | 일괄 처리 | `adapter.js` | 2h |
| P1-4 | CLI별 `--output-format json` 활용 | text만 사용 | `adapter.js` | 2h |
| P1-5 | Windows 호환성 강화 | 셸 이스케이핑 불일치 | `adapter.js` | 2h |
| P1-6 | 설정에 CLI별 고급 옵션 추가 | 옵션 고정 | `adapter.js`, `config.yaml` | 2h |

### P2 (스프린트 내 수정 - 확장성/유지보수)

| ID | 제목 | 현재 상태 | 대상 파일 | 예상 공수 |
|----|------|-----------|-----------|-----------|
| P2-1 | CLI 드라이버 플러그인 아키텍처로 전환 | switch-case 하드코딩 | `adapter.js` 리팩토링 | 8h |
| P2-2 | 임시 파일 기반 프롬프트 전달 옵션 | stdin만 사용 | `adapter.js` | 3h |
| P2-3 | CLI 버전 검증 추가 | 존재 여부만 확인 | `loader.js` | 2h |
| P2-4 | 재시도(retry) 로직 추가 | 재시도 없음 | `adapter.js` | 3h |
| P2-5 | 스트리밍 응답 지원 (stream-json) | 전체 응답 대기 | `adapter.js` | 5h |
| P2-6 | 응답 토큰 사용량 추적 | 미추적 | `adapter.js` | 2h |

---

## 4. 구현 계획

### Phase 1: P0 긴급 수정 (1-2일)

#### 4.1.1 Gemini CLI stdin 전환 + `_spawnShellCmd` 제거

**변경 파일**: `src/models/adapter.js`

**변경 전** (`_chatGemini`, L123-131):
```javascript
async _chatGemini(model, systemPrompt, userMessage) {
  const prompt = systemPrompt
    ? this._buildCombinedPrompt(systemPrompt, userMessage)
    : userMessage;
  const escaped = prompt.replace(/"/g, '\\"');
  let cmd = `gemini -p "${escaped}"`;
  if (model) cmd += ` -m ${model}`;
  return this._spawnShellCmd(cmd);
}
```

**변경 후**:
```javascript
async _chatGemini(model, systemPrompt, userMessage) {
  const prompt = systemPrompt
    ? this._buildCombinedPrompt(systemPrompt, userMessage)
    : userMessage;
  // Gemini CLI는 stdin pipe를 지원하므로 안전한 stdin 방식 사용
  const args = ["--output-format", "text"];
  if (model) args.push("-m", model);
  return this._spawnCli("gemini", args, prompt);
}
```

**삭제 대상**: `_spawnShellCmd` 메서드 전체 (L52-78), 관련 주석 (L47-51)

**검증 방법**:
```bash
echo "Hello, reply with OK" | gemini --output-format text -m gemini-2.5-flash
```

#### 4.1.2 CLI 호출 타임아웃 구현

**변경 파일**: `src/models/adapter.js`

**변경**: `_spawnCli` 메서드에 타임아웃 매개변수 추가

```javascript
_spawnCli(command, args, stdinData, options = {}) {
  const timeout = options.timeout || this.config.cli_timeout || 300000; // 기본 5분

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    // 타임아웃 타이머
    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGTERM");
      // SIGTERM 후 5초 대기 후 SIGKILL
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, 5000);
      reject(new Error(
        `CLI 타임아웃 (${command}, ${timeout / 1000}초 초과). ` +
        `부분 출력: ${stdout.substring(0, 200)}`
      ));
    }, timeout);

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`CLI 실행 실패 (${command}): ${err.message}`));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (killed) return; // 이미 타임아웃으로 reject됨
      if (code !== 0) {
        reject(new Error(`CLI 오류 (${command}, exit ${code}): ${stderr || stdout}`));
      } else {
        resolve(stdout.trim());
      }
    });

    if (stdinData) proc.stdin.write(stdinData);
    proc.stdin.end();
  });
}
```

**설정 추가** (`polymeld.config.yaml`):
```yaml
# CLI 호출 설정
cli:
  # 기본 타임아웃 (밀리초). 0이면 무제한.
  timeout: 300000        # 5분
  # CLI별 타임아웃 오버라이드
  timeouts:
    claude: 600000       # 10분 (복잡한 추론 작업)
    gemini: 300000       # 5분
    codex: 300000        # 5분
```

---

### Phase 2: P1 기능 개선 (3-5일)

#### 4.2.1 Codex CLI 호출 방식 정정

**변경 전** (`_chatCodex`, L139-145):
```javascript
async _chatCodex(model, systemPrompt, userMessage) {
  const prompt = systemPrompt
    ? this._buildCombinedPrompt(systemPrompt, userMessage)
    : userMessage;
  const args = ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "-"];
  return this._spawnCli("codex", args, prompt);
}
```

**변경 후**:
```javascript
async _chatCodex(model, systemPrompt, userMessage) {
  const prompt = systemPrompt
    ? this._buildCombinedPrompt(systemPrompt, userMessage)
    : userMessage;

  const args = [
    "exec",
    "--sandbox", "read-only",
    "--skip-git-repo-check",
    "-q",                       // quiet 모드: TUI 비활성화
    "--ask-for-approval", "never", // 비대화형에서 승인 프롬프트 방지
  ];

  // 임시 파일을 통해 프롬프트 전달 (안전한 방식)
  // 또는 위치 인수로 전달
  args.push("--", prompt);

  return this._spawnCli("codex", args, null);
}
```

**대안 검토**: 프롬프트가 매우 긴 경우(OS 명령줄 길이 제한 초과 가능):
```javascript
// 긴 프롬프트의 경우 임시 파일 사용
async _chatCodexWithTempFile(model, systemPrompt, userMessage) {
  const prompt = systemPrompt
    ? this._buildCombinedPrompt(systemPrompt, userMessage)
    : userMessage;

  const tmpFile = path.join(os.tmpdir(), `codex-prompt-${Date.now()}.txt`);
  try {
    fs.writeFileSync(tmpFile, prompt, "utf-8");
    const args = [
      "exec",
      "--sandbox", "read-only",
      "--skip-git-repo-check",
      "-q",
      "--ask-for-approval", "never",
    ];
    // stdin으로 파일 내용 파이핑
    const stdinData = fs.readFileSync(tmpFile, "utf-8");
    return await this._spawnCli("codex", args, stdinData);
  } finally {
    fs.unlinkSync(tmpFile);
  }
}
```

#### 4.2.2 출력 포맷 정규화 레이어

**새 메서드 추가** (`adapter.js`):
```javascript
/**
 * CLI 출력에서 잡음을 제거하고 순수 텍스트를 추출
 */
_normalizeOutput(raw, cli) {
  let text = raw;

  // 1. ANSI 이스케이프 코드 제거
  text = text.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ""
  );

  // 2. CLI별 래퍼 제거
  if (cli === "codex") {
    // Codex의 진행률 표시/헤더 제거
    text = text.replace(/^(Thinking|Executing|Reading).*\n/gm, "");
  }

  // 3. 선행/후행 공백 정리
  text = text.trim();

  return text;
}

/**
 * JSON 출력 모드 사용 시 result 필드 추출
 */
_parseJsonOutput(raw, cli) {
  try {
    // NDJSON의 경우 마지막 유효 JSON 라인 사용
    const lines = raw.trim().split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]);
        // CLI별 result 필드 추출
        if (cli === "claude" && parsed.result) return parsed.result;
        if (cli === "gemini" && parsed.response) return parsed.response;
        return parsed;
      } catch { continue; }
    }
  } catch { /* fall through */ }
  return raw; // 파싱 실패 시 원본 반환
}
```

#### 4.2.3 에러 핸들링 통합

**새 커스텀 에러 클래스**:
```javascript
export class CliError extends Error {
  constructor(cli, exitCode, stderr, stdout) {
    const message = CliError._buildMessage(cli, exitCode, stderr, stdout);
    super(message);
    this.name = "CliError";
    this.cli = cli;
    this.exitCode = exitCode;
    this.stderr = stderr;
    this.stdout = stdout;
    this.category = CliError._categorize(cli, exitCode);
  }

  static _categorize(cli, code) {
    // Gemini 고유 종료 코드
    if (cli === "gemini") {
      if (code === 41) return "auth";
      if (code === 42) return "input";
      if (code === 44) return "sandbox";
      if (code === 52) return "config";
      if (code === 53) return "turn_limit";
    }
    // Claude 고유 종료 코드
    if (cli === "claude" && code === 2) return "blocking";
    // 일반 분류
    if (code === 1) return "runtime";
    return "unknown";
  }

  static _buildMessage(cli, code, stderr, stdout) {
    const output = stderr || stdout || "(출력 없음)";
    return `[${cli}] CLI 오류 (exit ${code}): ${output.substring(0, 500)}`;
  }

  get isRetryable() {
    return ["runtime", "unknown"].includes(this.category);
  }
}
```

#### 4.2.4 CLI별 `--output-format json` 활용

**변경**: 각 CLI 메서드에서 JSON 출력 모드를 옵션으로 사용

```javascript
async _chatClaude(model, systemPrompt, userMessage) {
  const useJson = this.config.cli?.use_json_output ?? false;
  const outputFormat = useJson ? "json" : "text";

  const args = ["-p", "--output-format", outputFormat];
  if (model) args.push("--model", model);
  if (systemPrompt) args.push("--system-prompt", systemPrompt);

  // max-turns 제한으로 무한 에이전트 루프 방지
  const maxTurns = this.config.cli?.max_turns?.claude ?? 5;
  args.push("--max-turns", String(maxTurns));

  const raw = await this._spawnCli("claude", args, userMessage);
  return useJson ? this._parseJsonOutput(raw, "claude") : this._normalizeOutput(raw, "claude");
}

async _chatGemini(model, systemPrompt, userMessage) {
  const prompt = systemPrompt
    ? this._buildCombinedPrompt(systemPrompt, userMessage)
    : userMessage;

  const useJson = this.config.cli?.use_json_output ?? false;
  const outputFormat = useJson ? "json" : "text";

  const args = ["--output-format", outputFormat];
  if (model) args.push("-m", model);

  const raw = await this._spawnCli("gemini", args, prompt);
  return useJson ? this._parseJsonOutput(raw, "gemini") : this._normalizeOutput(raw, "gemini");
}
```

#### 4.2.5 설정 스키마 확장

**`polymeld.config.yaml` 추가 섹션**:
```yaml
# CLI 공통 설정
cli:
  # 기본 타임아웃 (밀리초)
  timeout: 300000
  # JSON 출력 모드 사용 (출력 파싱 안정성 향상)
  use_json_output: false
  # CLI별 타임아웃 오버라이드
  timeouts:
    claude: 600000
    gemini: 300000
    codex: 300000
  # CLI별 최대 턴 수
  max_turns:
    claude: 5
  # 재시도 설정
  retry:
    max_attempts: 3
    initial_delay_ms: 2000
    backoff_multiplier: 2
```

---

### Phase 3: P2 아키텍처 개선 (1-2주)

#### 4.3.1 CLI 드라이버 플러그인 아키텍처

**새 디렉토리 구조**:
```
src/models/
├── adapter.js              ← 통합 인터페이스 (변경)
├── base-driver.js          ← 새로 생성: 기본 드라이버 클래스
├── drivers/
│   ├── claude-driver.js    ← 새로 생성: Claude 전용 드라이버
│   ├── gemini-driver.js    ← 새로 생성: Gemini 전용 드라이버
│   └── codex-driver.js     ← 새로 생성: Codex 전용 드라이버
└── output-normalizer.js    ← 새로 생성: 출력 정규화
```

**기본 드라이버 클래스** (`base-driver.js`):
```javascript
export class BaseCliDriver {
  constructor(config) {
    this.config = config;
  }

  /** CLI 이름 */
  get name() { throw new Error("서브클래스에서 구현 필요"); }

  /** CLI 바이너리 명령어 */
  get command() { throw new Error("서브클래스에서 구현 필요"); }

  /** 시스템 프롬프트 네이티브 지원 여부 */
  get supportsSystemPrompt() { return false; }

  /** 비대화형 모드 인수 생성 */
  buildArgs(model, systemPrompt, userMessage, options) {
    throw new Error("서브클래스에서 구현 필요");
  }

  /** stdin으로 전달할 데이터 생성 (null이면 stdin 미사용) */
  buildStdinData(model, systemPrompt, userMessage, options) {
    return null;
  }

  /** 출력 정규화 */
  normalizeOutput(raw) {
    return raw.trim();
  }

  /** 종료 코드 분류 */
  categorizeExitCode(code) {
    return code === 0 ? "success" : "error";
  }
}
```

**변경된 adapter.js**:
```javascript
import { ClaudeDriver } from "./drivers/claude-driver.js";
import { GeminiDriver } from "./drivers/gemini-driver.js";
import { CodexDriver } from "./drivers/codex-driver.js";

export class ModelAdapter {
  constructor(config) {
    this.config = config;
    this.drivers = {
      claude: new ClaudeDriver(config),
      gemini: new GeminiDriver(config),
      codex: new CodexDriver(config),
    };
    this._availableCache = null;
  }

  async chat(modelKey, systemPrompt, userMessage, options = {}) {
    const modelConfig = this.config.models[modelKey];
    if (!modelConfig) throw new Error(`모델 설정을 찾을 수 없습니다: ${modelKey}`);

    const driver = this.drivers[modelConfig.cli];
    if (!driver) throw new Error(`지원하지 않는 CLI: ${modelConfig.cli}`);

    const args = driver.buildArgs(modelConfig.model, systemPrompt, userMessage, options);
    const stdinData = driver.buildStdinData(modelConfig.model, systemPrompt, userMessage, options);

    const raw = await this._spawnCli(driver.command, args, stdinData, {
      timeout: this.config.cli?.timeouts?.[modelConfig.cli] || this.config.cli?.timeout,
    });

    return driver.normalizeOutput(raw);
  }
  // ...
}
```

#### 4.3.2 재시도(Retry) 로직

```javascript
async _spawnCliWithRetry(command, args, stdinData, options = {}) {
  const retryConfig = this.config.cli?.retry || {};
  const maxAttempts = retryConfig.max_attempts || 3;
  const initialDelay = retryConfig.initial_delay_ms || 2000;
  const backoffMultiplier = retryConfig.backoff_multiplier || 2;

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await this._spawnCli(command, args, stdinData, options);
    } catch (err) {
      lastError = err;

      // 재시도 불가능한 에러 판별
      if (err instanceof CliError && !err.isRetryable) throw err;
      if (err.message.includes("타임아웃") && attempt >= 2) throw err;

      // 마지막 시도가 아니면 백오프 대기
      if (attempt < maxAttempts) {
        const delay = initialDelay * Math.pow(backoffMultiplier, attempt - 1);
        console.warn(
          `  ⚠️  ${command} 호출 실패 (시도 ${attempt}/${maxAttempts}), ` +
          `${delay / 1000}초 후 재시도: ${err.message.substring(0, 100)}`
        );
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}
```

#### 4.3.3 CLI 버전 검증

**변경 파일**: `src/config/loader.js`

```javascript
function getCliVersion(command) {
  try {
    const result = execFileSync(command, ["--version"], {
      stdio: "pipe",
      shell: true,
      timeout: 10000,
    });
    return result.toString().trim();
  } catch {
    return null;
  }
}

function validateCliVersion(cli, version) {
  // 최소 버전 요구사항 (향후 관리 필요)
  const minVersions = {
    claude: "1.0.0",  // --system-prompt, --output-format 지원
    gemini: "0.20.0", // stdin pipe, --output-format 지원
    codex:  "0.100.0", // exec 모드, --json 지원
  };

  if (!version) return { ok: false, reason: "버전 확인 불가" };

  const match = version.match(/(\d+\.\d+\.\d+)/);
  if (!match) return { ok: true, reason: "버전 형식 비표준" };

  // 시맨틱 버전 비교 (간단 구현)
  const current = match[1].split(".").map(Number);
  const min = (minVersions[cli] || "0.0.0").split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    if (current[i] > min[i]) return { ok: true };
    if (current[i] < min[i]) {
      return {
        ok: false,
        reason: `최소 버전 ${minVersions[cli]} 필요 (현재: ${match[1]})`,
      };
    }
  }
  return { ok: true };
}
```

---

### 단계별 작업 순서 요약

```
Week 1 (P0 긴급):
  Day 1-2:
    ├── P0-1: Gemini stdin 전환
    ├── P0-3: _spawnShellCmd 제거
    └── P0-2: 타임아웃 구현
    └── 테스트: 3종 CLI 기본 호출 검증

Week 1-2 (P1 기능):
  Day 3-4:
    ├── P1-1: Codex exec 호출 정정
    ├── P1-3: 에러 핸들링 통합 (CliError 클래스)
    └── P1-5: Windows 호환성 테스트/수정
  Day 5-7:
    ├── P1-2: 출력 정규화 레이어
    ├── P1-4: JSON 출력 모드 옵션
    └── P1-6: 설정 스키마 확장

Week 2-3 (P2 아키텍처):
  Day 8-10:
    ├── P2-1: 드라이버 플러그인 아키텍처
    └── P2-2: 임시 파일 방식 추가
  Day 11-12:
    ├── P2-3: CLI 버전 검증
    └── P2-4: 재시도 로직
  Day 13-15:
    ├── P2-5: 스트리밍 응답 지원 (선택)
    ├── P2-6: 토큰 사용량 추적 (선택)
    └── 통합 테스트 및 문서화
```

---

## 5. 리스크 분석

### 5.1 호환성 리스크

| 리스크 | 영향 | 확률 | 완화 방안 |
|--------|------|------|-----------|
| Gemini CLI stdin 미지원 버전에서 실행 | 높음 | 낮음 | CLI 버전 검증 추가 (P2-3), 폴백으로 `-p` 인수 방식 유지 |
| Codex CLI `exec` 인수 변경 | 중간 | 낮음 | `codex exec --help` 출력 기반 동적 감지, 또는 버전별 분기 |
| Claude `--system-prompt` 플래그 제거/변경 | 높음 | 매우 낮음 | 공식 문서가 명확, `_buildCombinedPrompt` 폴백 유지 |
| 각 CLI의 파괴적 업데이트 | 높음 | 중간 | `package.json`에 CLI 버전 핀닝 권장, 버전 검증 레이어 |
| Windows에서 `shell: true` + stdin 조합 문제 | 중간 | 중간 | 임시 파일 폴백 (P2-2), CI에서 Windows 테스트 |

### 5.2 마이그레이션 전략

#### Phase 1 (P0) 마이그레이션 -- 무중단
- `_chatGemini`만 변경, 다른 메서드는 건드리지 않음
- `_spawnShellCmd` 제거 전에 Gemini stdin 방식이 동작 확인 후 삭제
- 타임아웃은 기본값 5분으로 충분히 여유있게 설정

#### Phase 2 (P1) 마이그레이션 -- 설정 호환
- `config.yaml`에 `cli` 섹션 추가는 선택적 (없으면 기본값 사용)
- 기존 설정 파일이 그대로 동작해야 함
- `use_json_output: false`가 기본값이므로 기존 동작 유지

#### Phase 3 (P2) 마이그레이션 -- 점진적 리팩토링
- 드라이버 아키텍처 전환 시 기존 `adapter.js`의 공개 인터페이스(`chat`, `generateCode`, `reviewCode`)는 변경 없음
- `agent.js`, `team.js`, `orchestrator.js`는 `adapter.chat()`만 호출하므로 영향 없음
- 내부 구현만 변경되므로 외부 인터페이스 호환성 보장

### 5.3 테스트 전략

```
1. 단위 테스트 (각 드라이버):
   - 각 CLI별 args 빌드 로직 검증
   - 출력 정규화 함수 검증
   - 에러 분류 로직 검증

2. 통합 테스트 (Mock CLI):
   - CLI 바이너리를 모킹하는 스크립트로 e2e 테스트
   - 타임아웃 시나리오 테스트
   - 재시도 시나리오 테스트
   - 종료 코드별 에러 처리 테스트

3. 수동 검증:
   - polymeld test-models 명령으로 3종 CLI 연결 확인
   - polymeld meeting kickoff "테스트 주제"로 실제 파이프라인 검증
   - Windows/macOS/Linux 크로스 플랫폼 테스트
```

### 5.4 각 CLI 입력 방식 비교 (최종 권장)

| 방식 | 장점 | 단점 | 권장 CLI |
|------|------|------|----------|
| **stdin pipe** | 셸 이스케이핑 불필요, 길이 제한 없음, 보안 | 비동기 처리 필요 | Claude, Gemini, Codex |
| **위치 인수** | 단순, 디버깅 쉬움 | OS 명령줄 길이 제한 (Windows: 8191자), 이스케이핑 필요 | 짧은 프롬프트 전용 |
| **임시 파일** | 매우 긴 프롬프트 안전 처리, 디버깅용 보관 가능 | 파일 I/O 오버헤드, cleanup 필요 | 초대형 프롬프트 폴백 |
| **셸 문자열 (`_spawnShellCmd`)** | 없음 (모든 면에서 열등) | 인젝션 위험, 이스케이핑 복잡, 플랫폼 의존 | **사용 금지 (제거 대상)** |

**최종 결론**: 모든 CLI에서 **stdin pipe 방식을 기본**으로 사용하고, 프롬프트가 100KB를 초과하는 극단적 경우에만 **임시 파일 폴백**을 활성화합니다.

---

## 부록: 변경 영향도 매트릭스

| 소스 파일 | P0 변경 | P1 변경 | P2 변경 | 변경 이유 |
|-----------|---------|---------|---------|-----------|
| `src/models/adapter.js` | O | O | O (리팩토링) | 핵심 대상 |
| `src/models/base-driver.js` | - | - | O (신규) | 플러그인 아키텍처 |
| `src/models/drivers/*.js` | - | - | O (신규) | CLI별 드라이버 |
| `src/models/output-normalizer.js` | - | O (신규) | O | 출력 정규화 |
| `src/config/loader.js` | - | - | O | 버전 검증 추가 |
| `polymeld.config.yaml` | - | O | O | 설정 스키마 확장 |
| `src/agents/agent.js` | - | - | - | 변경 없음 (인터페이스 유지) |
| `src/agents/team.js` | - | - | - | 변경 없음 |
| `src/pipeline/orchestrator.js` | - | - | - | 변경 없음 |
| `src/github/client.js` | - | - | - | 변경 없음 |
| `src/index.js` | - | - | - | 변경 없음 |
| `package.json` | - | - | - | 의존성 변경 없음 |

---

*이 문서는 2026-03-06 기준 각 CLI의 최신 공식 문서 및 GitHub 리포지토리 분석을 기반으로 작성되었습니다.*
*CLI 도구들은 활발히 개발 중이므로, 구현 전 반드시 `--help` 출력과 최신 릴리스 노트를 재확인하시기 바랍니다.*
