# REPL Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an interactive REPL shell that wraps the existing one-shot pipeline, maintaining session context between runs and enabling slash commands for status inspection.

**Architecture:** REPL shell (readline) wraps existing PipelineOrchestrator. Session class bundles SharedContext + Mailbox + runs history. SessionStore handles JSON serialization to disk. Existing code is untouched except additive serialize/deserialize methods on SharedContext and Mailbox.

**Tech Stack:** Node.js readline (built-in), existing chalk/inquirer/ora, JSON file I/O

**Design doc:** `docs/plans/2026-03-06-repl-mode-design.md`

---

### Task 1: SharedContext serialize/deserialize

**Files:**
- Modify: `src/context/shared-context.js` (add 2 methods at end, ~30 lines)

**Step 1: Add `serialize()` method to SharedContext**

Add after the existing `snapshot()` method (line ~186):

```js
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
```

**Step 2: Verify existing tests still pass (if any)**

Run: `node -e "import('./src/context/shared-context.js').then(m => { const sc = new m.SharedContext(); sc.set('test', 'val', {author:'x',phase:'y'}); const json = sc.toJSON(); const sc2 = m.SharedContext.fromJSON(json); console.log(sc2.get('test') === 'val' ? 'PASS' : 'FAIL'); })"`
Expected: PASS

**Step 3: Commit**

```bash
git add src/context/shared-context.js
git commit -m "feat: add toJSON/fromJSON to SharedContext for session persistence"
```

---

### Task 2: Mailbox serialize/deserialize

**Files:**
- Modify: `src/context/mailbox.js` (add 2 methods at end, ~30 lines)

**Step 1: Add `toJSON()` and `fromJSON()` to Mailbox**

Add after the existing `exportLog()` method (line ~270):

```js
/**
 * JSON 직렬화 가능한 객체로 변환 (세션 저장용)
 * @returns {Object}
 */
toJSON() {
  return {
    allMessages: this.allMessages,
    inboxes: Object.fromEntries(
      Array.from(this.inboxes.entries()).map(([k, v]) => [k, v])
    ),
    nextId: this._nextId,
  };
}

/**
 * JSON에서 Mailbox 복원
 * @param {Object} data - toJSON()의 반환값
 * @returns {Mailbox}
 */
static fromJSON(data) {
  const mb = new Mailbox();
  if (data.allMessages) {
    mb.allMessages = data.allMessages;
  }
  if (data.nextId) {
    mb._nextId = data.nextId;
  }
  if (data.inboxes) {
    for (const [agentId, messages] of Object.entries(data.inboxes)) {
      mb.inboxes.set(agentId, messages);
    }
  }
  return mb;
}
```

**Step 2: Quick verification**

Run: `node -e "import('./src/context/mailbox.js').then(m => { const mb = new m.Mailbox(); mb.registerAgents(['a','b']); mb.send({from:'a',to:'b',type:'test',payload:{content:'hi'}}); const json = mb.toJSON(); const mb2 = m.Mailbox.fromJSON(json); console.log(mb2.getInbox('b').length === 1 ? 'PASS' : 'FAIL'); })"`
Expected: PASS

**Step 3: Commit**

```bash
git add src/context/mailbox.js
git commit -m "feat: add toJSON/fromJSON to Mailbox for session persistence"
```

---

### Task 3: SessionStore (disk persistence)

**Files:**
- Create: `src/session/session-store.js`

**Step 1: Create SessionStore**

```js
// src/session/session-store.js
// 세션 데이터를 디스크에 저장/복원

import fs from "fs";
import path from "path";

const SESSIONS_DIR = ".agent-team/sessions";

export class SessionStore {
  constructor(baseDir = process.cwd()) {
    this.dir = path.join(baseDir, SESSIONS_DIR);
  }

  _ensureDir() {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  /**
   * 세션 데이터를 JSON 파일로 저장
   * @param {string} id - 세션 ID
   * @param {Object} data - 직렬화된 세션 데이터
   */
  save(id, data) {
    this._ensureDir();
    const filePath = path.join(this.dir, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    return filePath;
  }

  /**
   * 세션 데이터를 파일에서 복원
   * @param {string} id - 세션 ID
   * @returns {Object|null}
   */
  load(id) {
    const filePath = path.join(this.dir, `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  }

  /**
   * 저장된 세션 목록 반환
   * @returns {Array<{id: string, updatedAt: string, file: string}>}
   */
  list() {
    this._ensureDir();
    const files = fs.readdirSync(this.dir).filter(f => f.endsWith(".json"));
    return files.map(f => {
      const id = f.replace(".json", "");
      const filePath = path.join(this.dir, f);
      const stat = fs.statSync(filePath);
      return { id, updatedAt: stat.mtime.toISOString(), file: f };
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * 세션 파일 삭제
   * @param {string} id
   */
  delete(id) {
    const filePath = path.join(this.dir, `${id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}
```

**Step 2: Commit**

```bash
git add src/session/session-store.js
git commit -m "feat: add SessionStore for disk persistence"
```

---

### Task 4: Session class

**Files:**
- Create: `src/session/session.js`

**Step 1: Create Session class**

```js
// src/session/session.js
// REPL 세션 관리 - SharedContext + Mailbox + 실행 이력을 묶어서 관리

import crypto from "crypto";
import chalk from "chalk";
import inquirer from "inquirer";
import { SharedContext } from "../context/shared-context.js";
import { Mailbox } from "../context/mailbox.js";
import { ContextBuilder } from "../context/context-builder.js";
import { ModelAdapter } from "../models/adapter.js";
import { Team } from "../agents/team.js";
import { GitHubClient } from "../github/client.js";
import { PipelineOrchestrator } from "../pipeline/orchestrator.js";
import { SessionStore } from "./session-store.js";

export class Session {
  constructor(config) {
    this.id = crypto.randomBytes(6).toString("hex");
    this.config = config;
    this.sharedContext = new SharedContext();
    this.mailbox = new Mailbox();
    this.contextBuilder = new ContextBuilder(this.sharedContext, this.mailbox, {
      maxChars: config.pipeline?.max_context_chars || 6000,
    });
    this.adapter = new ModelAdapter(config);
    this.team = null;
    this.github = null;
    this.runs = [];
    this.createdAt = new Date().toISOString();
    this.store = new SessionStore();

    this._initGitHub();
  }

  _initGitHub() {
    if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPO) {
      this.github = new GitHubClient(
        process.env.GITHUB_TOKEN,
        process.env.GITHUB_REPO
      );
    }
  }

  _ensureTeam() {
    if (!this.team) {
      const contextDeps = {
        sharedContext: this.sharedContext,
        mailbox: this.mailbox,
        contextBuilder: this.contextBuilder,
      };
      this.team = new Team(this.config, this.adapter, contextDeps);
    }
  }

  /**
   * 파이프라인 실행 (기존 Orchestrator 그대로 사용)
   */
  async runPipeline(requirement, options = {}) {
    this._ensureTeam();

    const interactionMode = options.mode || this.config.pipeline?.interaction_mode || "semi-auto";

    // 프로젝트 제목 결정
    const title = options.title || await this._askTitle(requirement, interactionMode);

    // SharedContext에 프로젝트 정보 설정
    this.sharedContext.set("project.requirement", requirement, {
      author: "orchestrator",
      phase: "init",
      summary: requirement.substring(0, 200),
    });
    this.sharedContext.set("project.title", title, {
      author: "orchestrator",
      phase: "init",
    });

    // GitHub 초기화
    if (this.github) {
      await this.github.ensureLabels(this.config.github?.labels || {});
      await this.github.findOrCreateProject(
        this.config.github?.project_name || "Agent Team Board"
      );
    }

    const contextDeps = {
      sharedContext: this.sharedContext,
      mailbox: this.mailbox,
      contextBuilder: this.contextBuilder,
    };

    const orchestrator = new PipelineOrchestrator(
      this.team,
      this.github || new NoOpGitHub(),
      this.config,
      interactionMode,
      contextDeps
    );

    const runEntry = {
      requirement,
      title,
      startedAt: new Date().toISOString(),
      status: "running",
    };
    this.runs.push(runEntry);

    try {
      await orchestrator.run(requirement, title);
      runEntry.status = "completed";
      runEntry.completedAt = new Date().toISOString();
    } catch (error) {
      runEntry.status = "failed";
      runEntry.error = error.message;
      throw error;
    }
  }

  async _askTitle(requirement, interactionMode) {
    if (interactionMode === "full-auto") {
      return requirement.substring(0, 30);
    }
    const { title } = await inquirer.prompt([{
      type: "input",
      name: "title",
      message: "프로젝트 제목:",
      default: requirement.substring(0, 30),
    }]);
    return title;
  }

  /**
   * 직렬화
   */
  toJSON() {
    return {
      id: this.id,
      createdAt: this.createdAt,
      updatedAt: new Date().toISOString(),
      runs: this.runs,
      sharedContext: this.sharedContext.toJSON(),
      mailbox: this.mailbox.toJSON(),
    };
  }

  /**
   * 복원
   */
  static fromJSON(data, config) {
    const session = new Session(config);
    session.id = data.id;
    session.createdAt = data.createdAt;
    session.runs = data.runs || [];
    session.sharedContext = SharedContext.fromJSON(data.sharedContext || {});
    session.mailbox = Mailbox.fromJSON(data.mailbox || {});
    session.contextBuilder = new ContextBuilder(
      session.sharedContext,
      session.mailbox,
      { maxChars: config.pipeline?.max_context_chars || 6000 }
    );
    return session;
  }

  /**
   * 세션 저장
   */
  save() {
    const filePath = this.store.save(this.id, this.toJSON());
    return filePath;
  }

  /**
   * 마지막 실행 제목
   */
  get lastRunTitle() {
    if (this.runs.length === 0) return null;
    return this.runs[this.runs.length - 1].title;
  }
}

/**
 * GitHub 미설정 시 사용하는 No-op 클라이언트
 * PipelineOrchestrator가 github 메서드를 호출해도 에러 나지 않음
 */
class NoOpGitHub {
  async ensureLabels() {}
  async findOrCreateProject() {}
  async createIssue(title) { return { number: 0, node_id: "" }; }
  async addComment() {}
  async updateLabels() {}
  async closeIssue() {}
  async addIssueToProject() {}
  async createBranch() {}
  async commitFile() {}
  async createPR() { return { number: 0 }; }
}
```

**Step 2: Commit**

```bash
git add src/session/session.js
git commit -m "feat: add Session class with pipeline execution and serialization"
```

---

### Task 5: REPL slash commands

**Files:**
- Create: `src/repl/commands/status.js`
- Create: `src/repl/commands/history.js`
- Create: `src/repl/commands/save.js`
- Create: `src/repl/commands/load.js`
- Create: `src/repl/commands/team.js`
- Create: `src/repl/commands/context.js`
- Create: `src/repl/commands/help.js`

**Step 1: Create all command files**

`src/repl/commands/status.js`:
```js
import chalk from "chalk";

export function statusCommand(session) {
  const runs = session.runs;
  if (runs.length === 0) {
    console.log(chalk.gray("  아직 실행 이력이 없습니다. 자연어로 요구사항을 입력하세요."));
    return;
  }

  const last = runs[runs.length - 1];
  console.log(chalk.bold("\n  📋 세션 상태\n"));
  console.log(`  세션 ID: ${chalk.cyan(session.id)}`);
  console.log(`  총 실행: ${runs.length}회`);
  console.log(`  마지막: ${chalk.bold(last.title)} (${last.status})`);

  const slotCount = session.sharedContext.slots.size;
  const msgCount = session.mailbox.allMessages.length;
  console.log(`  SharedContext: ${slotCount}개 슬롯`);
  console.log(`  Mailbox: ${msgCount}개 메시지\n`);
}
```

`src/repl/commands/history.js`:
```js
import chalk from "chalk";

export function historyCommand(session) {
  const runs = session.runs;
  if (runs.length === 0) {
    console.log(chalk.gray("  실행 이력이 없습니다."));
    return;
  }

  console.log(chalk.bold("\n  📜 실행 이력\n"));
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const icon = run.status === "completed" ? "✅" : run.status === "failed" ? "❌" : "🔄";
    const time = run.startedAt?.split("T")[1]?.split(".")[0] || "";
    console.log(`  ${i + 1}. ${icon} ${run.title} (${time}) [${run.status}]`);
  }
  console.log();
}
```

`src/repl/commands/save.js`:
```js
import chalk from "chalk";

export function saveCommand(session, args) {
  try {
    const filePath = session.save();
    console.log(chalk.green(`  ✅ 세션 저장됨: ${filePath}`));
    console.log(chalk.gray(`  세션 ID: ${session.id}`));
  } catch (error) {
    console.log(chalk.red(`  ❌ 저장 실패: ${error.message}`));
  }
}
```

`src/repl/commands/load.js`:
```js
import chalk from "chalk";
import { SessionStore } from "../../session/session-store.js";
import { Session } from "../../session/session.js";

export function loadCommand(session, args, replShell) {
  const store = new SessionStore();

  if (!args) {
    // 인자 없으면 목록 표시
    const sessions = store.list();
    if (sessions.length === 0) {
      console.log(chalk.gray("  저장된 세션이 없습니다."));
      return;
    }
    console.log(chalk.bold("\n  💾 저장된 세션 목록\n"));
    for (const s of sessions) {
      const current = s.id === session.id ? chalk.cyan(" (현재)") : "";
      console.log(`  ${s.id} - ${s.updatedAt.split("T")[0]}${current}`);
    }
    console.log(chalk.gray(`\n  복원: /load <세션ID>`));
    return;
  }

  const data = store.load(args);
  if (!data) {
    console.log(chalk.red(`  ❌ 세션을 찾을 수 없습니다: ${args}`));
    return;
  }

  const restored = Session.fromJSON(data, session.config);
  replShell.session = restored;
  console.log(chalk.green(`  ✅ 세션 복원됨: ${args}`));
  console.log(chalk.gray(`  실행 이력: ${restored.runs.length}회`));
}
```

`src/repl/commands/team.js`:
```js
import chalk from "chalk";

export function teamCommand(session) {
  console.log(chalk.bold("\n  👥 팀 구성\n"));

  const personas = session.config.personas;
  for (const [id, persona] of Object.entries(personas)) {
    const onDemand = persona.on_demand ? chalk.gray(" (온디맨드)") : chalk.green(" (상시)");
    const modelColor =
      persona.model === "claude" ? chalk.hex("#D4A574") :
      persona.model === "gemini" ? chalk.hex("#4285F4") :
      chalk.hex("#10A37F");
    const imageTag = persona.image_model ? chalk.gray(` + ${persona.image_model}`) : "";
    console.log(`  ${persona.name} (${persona.role}): ${modelColor(persona.model)}${imageTag}${onDemand}`);
  }
  console.log();
}
```

`src/repl/commands/context.js`:
```js
import chalk from "chalk";

export function contextCommand(session) {
  const slots = session.sharedContext.slots;

  if (slots.size === 0) {
    console.log(chalk.gray("  SharedContext가 비어있습니다."));
    return;
  }

  console.log(chalk.bold("\n  🧠 SharedContext 슬롯\n"));
  for (const [name, slot] of slots) {
    const valuePreview = typeof slot.value === "string"
      ? slot.value.substring(0, 60)
      : JSON.stringify(slot.value).substring(0, 60);
    const meta = slot.metadata;
    console.log(`  ${chalk.cyan(name)} (v${meta.version}, by ${meta.author})`);
    console.log(chalk.gray(`    ${valuePreview}${valuePreview.length >= 60 ? "..." : ""}`));
  }
  console.log();
}
```

`src/repl/commands/help.js`:
```js
import chalk from "chalk";

export function helpCommand() {
  console.log(chalk.bold("\n  🤖 Agent Team REPL 도움말\n"));
  console.log(chalk.bold("  슬래시 커맨드:"));
  console.log("  /status       현재 세션 상태");
  console.log("  /history      실행 이력 조회");
  console.log("  /team         팀 구성 확인");
  console.log("  /context      SharedContext 슬롯 조회");
  console.log("  /save         세션 저장");
  console.log("  /load [id]    세션 복원 (인자 없으면 목록)");
  console.log("  /help         이 도움말");
  console.log("  /exit         REPL 종료 (자동 저장)\n");
  console.log(chalk.bold("  자연어 입력:"));
  console.log("  요구사항을 자연어로 입력하면 전체 파이프라인이 실행됩니다.");
  console.log(chalk.gray('  예: "사용자 인증 시스템을 만들어줘"\n'));
}
```

**Step 2: Commit**

```bash
git add src/repl/commands/
git commit -m "feat: add REPL slash commands (status, history, save, load, team, context, help)"
```

---

### Task 6: CommandRouter

**Files:**
- Create: `src/repl/command-router.js`

**Step 1: Create CommandRouter**

```js
// src/repl/command-router.js
// 슬래시 커맨드 vs 자연어 분기 처리

import chalk from "chalk";
import { statusCommand } from "./commands/status.js";
import { historyCommand } from "./commands/history.js";
import { saveCommand } from "./commands/save.js";
import { loadCommand } from "./commands/load.js";
import { teamCommand } from "./commands/team.js";
import { contextCommand } from "./commands/context.js";
import { helpCommand } from "./commands/help.js";

export class CommandRouter {
  constructor(replShell) {
    this.replShell = replShell;
  }

  get session() {
    return this.replShell.session;
  }

  /**
   * 입력을 라우팅
   * @param {string} input
   * @returns {Promise<"continue"|"exit">}
   */
  async route(input) {
    const trimmed = input.trim();
    if (!trimmed) return "continue";

    if (trimmed.startsWith("/")) {
      return this.handleSlash(trimmed);
    }
    return this.handleNatural(trimmed);
  }

  async handleSlash(input) {
    const [cmd, ...argParts] = input.split(/\s+/);
    const args = argParts.join(" ").trim() || null;

    switch (cmd.toLowerCase()) {
      case "/status":
        statusCommand(this.session);
        break;
      case "/history":
        historyCommand(this.session);
        break;
      case "/save":
        saveCommand(this.session, args);
        break;
      case "/load":
        loadCommand(this.session, args, this.replShell);
        break;
      case "/team":
        teamCommand(this.session);
        break;
      case "/context":
        contextCommand(this.session);
        break;
      case "/help":
        helpCommand();
        break;
      case "/exit":
      case "/quit":
        return "exit";
      default:
        console.log(chalk.yellow(`  알 수 없는 커맨드: ${cmd}`));
        console.log(chalk.gray("  /help 로 사용 가능한 커맨드를 확인하세요."));
    }
    return "continue";
  }

  async handleNatural(input) {
    console.log(chalk.bold.cyan("\n🤖 Agent Team 파이프라인 시작\n"));

    try {
      await this.session.runPipeline(input);
    } catch (error) {
      console.log(chalk.red(`\n❌ 파이프라인 실행 실패: ${error.message}`));
    }

    return "continue";
  }
}
```

**Step 2: Commit**

```bash
git add src/repl/command-router.js
git commit -m "feat: add CommandRouter for slash commands and natural language routing"
```

---

### Task 7: ReplShell (main REPL loop)

**Files:**
- Create: `src/repl/repl-shell.js`

**Step 1: Create ReplShell**

> **주의사항 (평가에서 발견):**
> - readline과 inquirer가 동시에 stdin을 잡으면 충돌함
>   → 파이프라인 실행 전 `rl.pause()`, 완료 후 `rl.resume()` 필수
> - `_handleExit`의 이중 호출 방지 → `_exiting` 플래그 사용
> - Ctrl+C는 파이프라인 실행 중이면 실행 중단, 프롬프트면 종료

```js
// src/repl/repl-shell.js
// 인터랙티브 REPL 셸 - readline 기반 프롬프트 루프

import readline from "readline";
import chalk from "chalk";
import { Session } from "../session/session.js";
import { SessionStore } from "../session/session-store.js";
import { CommandRouter } from "./command-router.js";

export class ReplShell {
  constructor(config) {
    this.config = config;
    this.session = new Session(config);
    this.router = new CommandRouter(this);
    this.rl = null;
    this._running = false;
    this._exiting = false;
  }

  /**
   * 저장된 세션 복원
   */
  loadSession(id) {
    const store = new SessionStore();

    // id가 true (--resume 플래그만 준 경우) → 최신 세션 로드
    if (id === true) {
      const sessions = store.list();
      if (sessions.length === 0) {
        console.log(chalk.yellow("  저장된 세션이 없습니다. 새 세션을 시작합니다."));
        return;
      }
      id = sessions[0].id;
    }

    const data = store.load(id);
    if (!data) {
      console.log(chalk.yellow(`  세션 ${id}를 찾을 수 없습니다. 새 세션을 시작합니다.`));
      return;
    }

    this.session = Session.fromJSON(data, this.config);
    console.log(chalk.green(`  ✅ 세션 복원: ${id} (실행 ${this.session.runs.length}회)\n`));
  }

  /**
   * REPL 메인 루프
   */
  async start() {
    this._printBanner();
    this._running = true;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Ctrl+C 핸들링
    this.rl.on("close", () => {
      if (this._running && !this._exiting) {
        this._handleExit();
      }
    });

    while (this._running) {
      const input = await this._prompt();
      if (input === null) break; // EOF

      try {
        // readline을 pause하여 inquirer와의 충돌 방지
        // (파이프라인 실행 중 InteractionManager가 inquirer를 사용함)
        this.rl.pause();
        const result = await this.router.route(input);
        this.rl.resume();

        if (result === "exit") {
          break;
        }
      } catch (error) {
        this.rl.resume();
        console.log(chalk.red(`  오류: ${error.message}`));
      }
    }

    this._handleExit();
  }

  _prompt() {
    const lastTitle = this.session.lastRunTitle;
    const prefix = lastTitle
      ? chalk.gray(`[${lastTitle.substring(0, 20)}] `)
      : "";
    const promptStr = `${prefix}${chalk.bold.green(">")} `;

    return new Promise((resolve) => {
      this.rl.question(promptStr, (answer) => {
        resolve(answer);
      });
    });
  }

  _printBanner() {
    console.log(chalk.bold.cyan("\n🤖 Agent Team CLI v0.1.0 - Interactive Mode\n"));
    console.log(chalk.gray("  요구사항을 자연어로 입력하면 전체 파이프라인이 실행됩니다."));
    console.log(chalk.gray("  /help 로 사용 가능한 커맨드를 확인하세요.\n"));

    // 팀 구성 간략 출력
    const personas = this.config.personas;
    const alwaysOn = Object.entries(personas).filter(([, p]) => !p.on_demand);
    const onDemand = Object.entries(personas).filter(([, p]) => p.on_demand);
    console.log(chalk.gray(`  상시 투입: ${alwaysOn.map(([, p]) => p.name).join(", ")}`));
    console.log(chalk.gray(`  온디맨드: ${onDemand.map(([, p]) => p.name).join(", ")}\n`));
  }

  _handleExit() {
    if (this._exiting) return; // 이중 호출 방지
    this._exiting = true;
    this._running = false;

    // 자동 저장
    if (this.session.runs.length > 0) {
      try {
        const filePath = this.session.save();
        console.log(chalk.gray(`\n  💾 세션 자동 저장: ${filePath}`));
      } catch (e) {
        console.log(chalk.yellow(`\n  ⚠️ 세션 저장 실패: ${e.message}`));
      }
    }

    console.log(chalk.gray("  👋 Agent Team REPL 종료\n"));

    if (this.rl) {
      this.rl.close();
    }
    process.exit(0);
  }
}
```

**Step 2: Commit**

```bash
git add src/repl/repl-shell.js
git commit -m "feat: add ReplShell with readline-based interactive prompt loop"
```

---

### Task 8: Wire up `start` command in index.js

**Files:**
- Modify: `src/index.js` (add ~20 lines, no existing code changed)

**Step 1: Add import and `start` command**

Add import at top (after existing imports, line ~17):

```js
import { ReplShell } from "./repl/repl-shell.js";
```

Add new command before `program.parse()` (before line 274):

```js
// ─── 인터랙티브 REPL 모드 ────────────────────────────

program
  .command("start")
  .description("인터랙티브 REPL 모드 - 대화형으로 파이프라인을 반복 실행")
  .option("-c, --config <path>", "설정 파일 경로")
  .option("--resume [id]", "이전 세션 이어하기 (ID 생략 시 최신 세션)")
  .action(async (options) => {
    const config = loadConfig(options.config);
    const shell = new ReplShell(config);

    if (options.resume !== undefined) {
      shell.loadSession(options.resume);
    }

    await shell.start();
  });
```

**Step 2: Verify the command is registered**

Run: `node src/index.js --help`
Expected: `start` command should appear in the list

**Step 3: Commit**

```bash
git add src/index.js
git commit -m "feat: add 'start' command for interactive REPL mode"
```

---

### Task 9: Add `.agent-team/sessions/` to .gitignore

**Files:**
- Modify: `.gitignore`

**Step 1: Add sessions directory to .gitignore**

Append:

```
# REPL 세션 데이터
.agent-team/sessions/
```

**Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: add .agent-team/sessions/ to .gitignore"
```

---

### Task 10: Manual integration test

**Step 1: Start REPL and verify banner**

Run: `node src/index.js start`
Expected: Banner with team composition and prompt

**Step 2: Test slash commands**

Type: `/help` → command list
Type: `/team` → team composition
Type: `/status` → "아직 실행 이력이 없습니다"
Type: `/context` → "SharedContext가 비어있습니다"
Type: `/save` → session saved
Type: `/load` → session list
Type: `/exit` → auto-save + exit

**Step 3: Test session resume**

Run: `node src/index.js start --resume`
Expected: Restores latest session

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: integration test fixes for REPL mode"
```
