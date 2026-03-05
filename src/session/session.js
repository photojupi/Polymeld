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
  async createIssue() { return { number: 0, node_id: "" }; }
  async addComment() {}
  async updateLabels() {}
  async closeIssue() {}
  async addIssueToProject() {}
  async createBranch() {}
  async commitFile() {}
  async createPR() { return { number: 0 }; }
}
