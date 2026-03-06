// src/session/session.js
// REPL 세션 관리 - PipelineState + PromptAssembler + 실행 이력을 묶어서 관리

import crypto from "crypto";
import fs from "fs";
import path from "path";
import chalk from "chalk";
import inquirer from "inquirer";
import { PipelineState } from "../state/pipeline-state.js";
import { PromptAssembler } from "../state/prompt-assembler.js";
import { ModelAdapter } from "../models/adapter.js";
import { Team } from "../agents/team.js";
import { GitHubClient, NoOpGitHub } from "../github/client.js";
import { PipelineOrchestrator } from "../pipeline/orchestrator.js";
import { SessionStore } from "./session-store.js";
import { LocalWorkspace } from "../workspace/local-workspace.js";
import { NoOpWorkspace } from "../workspace/noop-workspace.js";

export class Session {
  constructor(config) {
    this.id = crypto.randomBytes(6).toString("hex");
    this.config = config;
    this.state = new PipelineState();
    this.assembler = new PromptAssembler({
      maxChars: config.pipeline?.max_context_chars || 6000,
    });
    this.adapter = new ModelAdapter(config);
    this.team = null;
    this.github = null;
    this.workspace = null;
    this.runs = [];
    this.createdAt = new Date().toISOString();
    this.store = new SessionStore();

    this._initGitHub();
    this._initWorkspace();
  }

  _initGitHub() {
    if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPO) {
      this.github = new GitHubClient(
        process.env.GITHUB_TOKEN,
        process.env.GITHUB_REPO
      );
    }
  }

  _initWorkspace() {
    // 1순위: config에 명시된 경로
    const configPath = this.config.project?.local_path;
    if (configPath) {
      try {
        const resolved = configPath.startsWith("~")
          ? configPath.replace("~", process.env.HOME || "")
          : configPath;
        const ws = new LocalWorkspace(resolved);
        if (this._validateWorkspaceRemote(ws)) {
          this.workspace = ws;
          console.log(chalk.green(`  📂 워크스페이스: ${ws.repoPath}`));
          return;
        }
      } catch (e) {
        console.log(chalk.yellow(`  ⚠️ 설정된 워크스페이스 경로 오류: ${e.message}`));
      }
    }

    // 2순위: cwd 자동감지 (.git 존재 + 자기 자신이 아닌 경우)
    const cwd = process.cwd();
    if (fs.existsSync(path.join(cwd, ".git"))) {
      // agent-team 자체 레포에서 실행하는 경우 자동감지 건너뜀
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8"));
        if (pkg.name === "agent-team-cli" || pkg.name === "agent-team") {
          this.workspace = new NoOpWorkspace();
          return;
        }
      } catch {
        // package.json 없거나 파싱 실패 → 대상 프로젝트로 간주
      }
      try {
        const ws = new LocalWorkspace(cwd);
        if (this._validateWorkspaceRemote(ws)) {
          this.workspace = ws;
          console.log(chalk.green(`  📂 워크스페이스 (자동감지): ${cwd}`));
          return;
        }
      } catch {
        // 감지 실패 시 무시
      }
    }

    this.workspace = new NoOpWorkspace();
  }

  /**
   * 워크스페이스의 remote가 GITHUB_REPO와 일치하는지 검증
   * GITHUB_REPO 미설정 시에는 무조건 통과 (GitHub 없이 로컬만 사용)
   * @returns {boolean} 사용 가능 여부
   */
  _validateWorkspaceRemote(ws) {
    const envRepo = process.env.GITHUB_REPO;
    if (!envRepo) return true; // GitHub 미설정 → 로컬 전용 모드, 검증 불필요

    const localRepo = ws.getRemoteRepo();
    if (!localRepo) {
      // remote가 없는 로컬 레포 → GitHub API와 분리됨을 경고
      console.log(chalk.yellow(
        `  ⚠️ 워크스페이스에 origin remote가 없습니다. GitHub(${envRepo})와 연동되지 않습니다.`
      ));
      return true; // 로컬 작업은 허용
    }

    if (localRepo.toLowerCase() !== envRepo.toLowerCase()) {
      console.log(chalk.red(
        `  ❌ 워크스페이스 remote 불일치!\n` +
        `     로컬: ${localRepo}\n` +
        `     .env:  ${envRepo}\n` +
        `     → 워크스페이스를 건너뜁니다. config 또는 .env를 확인하세요.`
      ));
      return false;
    }

    return true;
  }

  _ensureTeam() {
    if (!this.team) {
      this.team = new Team(this.config, this.adapter, {
        state: this.state,
        assembler: this.assembler,
      });
    }
  }

  /**
   * 파이프라인 실행 (기존 Orchestrator 그대로 사용)
   */
  async runPipeline(requirement, options = {}) {
    this._ensureTeam();

    const interactionMode = options.mode || this.config.pipeline?.interaction_mode || "semi-auto";

    // 프로젝트 제목 결정
    const titleResult = options.title
      ? { title: options.title, isModification: false }
      : await this._askTitle(requirement, interactionMode);
    const { title, isModification } = titleResult;

    this.state.project.requirement = requirement;
    this.state.project.title = title;

    // runPipeline()은 항상 Phase 리셋 (재개는 /resume → resumePipeline()만 사용)
    this.state.resetPhases();

    // GitHub 초기화
    if (this.github) {
      await this.github.ensureLabels(this.config.github?.labels || {});
      await this.github.findOrCreateProject(`${this.github.repo}_autollm`);
    }

    const orchestrator = new PipelineOrchestrator(
      this.team,
      this.github || new NoOpGitHub(),
      this.config,
      interactionMode,
      {
        state: this.state,
        assembler: this.assembler,
        workspace: this.workspace,
        onPhaseSave: () => this.save(),
      }
    );

    const runEntry = {
      requirement,
      title,
      isModification,
      startedAt: new Date().toISOString(),
      status: "running",
    };
    this.runs.push(runEntry);

    try {
      await orchestrator.run(requirement, title, { isModification });
      runEntry.status = "completed";
      runEntry.completedAt = new Date().toISOString();
    } catch (error) {
      runEntry.status = "failed";
      runEntry.error = error.message;
      throw error;
    }
  }

  /**
   * 중단된 파이프라인 재개
   * completedPhases를 기반으로 이미 완료된 Phase를 건너뛰고 재실행
   */
  async resumePipeline(options = {}) {
    const { requirement, title } = this.state.project;
    if (!requirement) {
      throw new Error("재개할 파이프라인이 없습니다. 먼저 프로젝트를 실행해주세요.");
    }

    this._ensureTeam();

    const completed = this.state.completedPhases;
    console.log(chalk.cyan(`\n\u23EF\uFE0F  파이프라인 재개: "${title}"`));
    if (completed.length > 0) {
      console.log(chalk.gray(`  완료된 Phase: ${completed.join(", ")}`));
    }

    const interactionMode = options.mode || this.config.pipeline?.interaction_mode || "semi-auto";

    // GitHub 초기화
    if (this.github) {
      await this.github.ensureLabels(this.config.github?.labels || {});
      await this.github.findOrCreateProject(`${this.github.repo}_autollm`);
    }

    const orchestrator = new PipelineOrchestrator(
      this.team,
      this.github || new NoOpGitHub(),
      this.config,
      interactionMode,
      {
        state: this.state,
        assembler: this.assembler,
        workspace: this.workspace,
        onPhaseSave: () => this.save(),
      }
    );

    const runEntry = {
      requirement,
      title,
      startedAt: new Date().toISOString(),
      status: "running",
      resumed: true,
      resumedFrom: completed[completed.length - 1] || null,
    };
    this.runs.push(runEntry);

    try {
      // 이전 run에서 isModification 복원, 없으면 codebaseAnalysis 존재 여부로 판단
      const lastRun = this.runs.slice(0, -1).reverse().find(r => r.isModification != null);
      const isModification = lastRun?.isModification ?? (this.state.codebaseAnalysis != null);
      await orchestrator.run(requirement, title, { isModification });
      runEntry.status = "completed";
      runEntry.completedAt = new Date().toISOString();
    } catch (error) {
      runEntry.status = "failed";
      runEntry.error = error.message;
      throw error;
    }
  }

  async _askTitle(requirement, interactionMode) {
    const lastTitle = this.lastRunTitle;

    // 이전 실행이 있는 경우: 기존 프로젝트 계속 vs 새 프로젝트
    if (lastTitle) {
      if (interactionMode === "full-auto") {
        return { title: lastTitle, isModification: true };
      }
      const { choice } = await inquirer.prompt([{
        type: "list",
        name: "choice",
        message: `기존 프로젝트 "${lastTitle}"에 대한 수정인가요?`,
        choices: [
          { name: `예 — "${lastTitle}" 계속`, value: "continue" },
          { name: "아니요 — 새 프로젝트 시작", value: "new" },
        ],
      }]);
      if (choice === "continue") return { title: lastTitle, isModification: true };
    }

    // 새 프로젝트: 제목 입력
    if (interactionMode === "full-auto") {
      return { title: requirement.substring(0, 30), isModification: false };
    }
    const { title } = await inquirer.prompt([{
      type: "input",
      name: "title",
      message: "프로젝트 제목:",
      default: requirement.substring(0, 30),
    }]);
    return { title, isModification: false };
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
      state: this.state.toJSON(),
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
    // v1: state 필드 존재 → 직접 로드
    // v0: sharedContext/mailbox 필드 → 마이그레이션
    const stateData = data.state || { sharedContext: data.sharedContext, mailbox: data.mailbox };
    session.state = PipelineState.fromJSON(stateData);
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
