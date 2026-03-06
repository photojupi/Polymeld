// src/session/session.js
// REPL 세션 관리 - PipelineState + PromptAssembler + 실행 이력을 묶어서 관리

import crypto from "crypto";
import chalk from "chalk";
import inquirer from "inquirer";
import { PipelineState } from "../state/pipeline-state.js";
import { PromptAssembler } from "../state/prompt-assembler.js";
import { ModelAdapter } from "../models/adapter.js";
import { Team } from "../agents/team.js";
import { GitHubClient, NoOpGitHub } from "../github/client.js";
import { PipelineOrchestrator } from "../pipeline/orchestrator.js";
import { SessionStore } from "./session-store.js";

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
    const title = options.title || await this._askTitle(requirement, interactionMode);

    this.state.project.requirement = requirement;
    this.state.project.title = title;

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
      { state: this.state, assembler: this.assembler }
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
