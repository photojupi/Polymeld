// src/pipeline/orchestrator.js
// 파이프라인 오케스트레이터 - 전체 Phase를 순서대로 실행
// PipelineState + PromptAssembler 기반 컨텍스트 관리

import chalk from "chalk";
import ora from "ora";
import { InteractionManager } from "../config/interaction.js";
import { ResponseParser } from "../models/response-parser.js";
import { t } from "../i18n/index.js";


export class PipelineOrchestrator {
  /**
   * @param {import('../agents/team.js').Team} team
   * @param {import('../github/client.js').GitHubClient} github
   * @param {Object} config
   * @param {string} interactionMode
   * @param {Object} deps - 의존성
   * @param {import('../state/pipeline-state.js').PipelineState} deps.state
   * @param {import('../state/prompt-assembler.js').PromptAssembler} deps.assembler
   * @param {import('../workspace/local-workspace.js').LocalWorkspace|import('../workspace/noop-workspace.js').NoOpWorkspace} [deps.workspace]
   */
  constructor(team, github, config, interactionMode = "full-auto", { state, assembler, workspace, onPhaseSave }) {
    this.team = team;
    this.github = github;
    this.config = config;
    this.state = state;
    this.assembler = assembler;
    this.workspace = workspace;
    this.onPhaseSave = onPhaseSave || null;
    this.interaction = new InteractionManager(interactionMode, {
      timeout: config.pipeline?.auto_timeout || 0,
      defaultYes: true,
    });
    this._gitQueue = Promise.resolve();
  }

  async run(requirement, { isModification = false } = {}) {
    // 프로젝트 정보가 없으면 설정 (Session에서 이미 초기화되었을 수 있음)
    if (!this.state.project.requirement) {
      this.state.project.requirement = requirement;
    }
    const projectTitle = this.state.project.title;

    // 재개 시 에이전트 참조 재연결
    this._relinkAgents();

    const modeLabel = isModification ? t("pipeline.modeModification") : t("pipeline.modeNew");
    console.log(chalk.bold.cyan(`\n${t("pipeline.start", { mode: modeLabel })}\n`));
    console.log(chalk.gray(t("pipeline.project", { title: projectTitle })));
    console.log(chalk.gray(t("pipeline.requirement", { requirement })));
    console.log(chalk.gray(t("pipeline.interaction", { mode: this.interaction.mode }) + "\n"));

    // 모델 배정 현황 출력
    this._printModelAssignment();

    // Phase 0: 코드베이스 분석 (수정 모드 + 로컬 워크스페이스)
    if (isModification && this.workspace?.isLocal) {
      await this._phase(t("pipeline.phase.codebaseAnalysis"), () => this.phaseCodebaseAnalysis(requirement), { phaseId: "codebaseAnalysis" });
    }

    // Phase 1: 미팅
    await this._phase(t("pipeline.phase.planning"), () => this.phasePlanning(), { phaseId: "planning" });

    // Phase 2: 태스크 분해
    await this._phase(t("pipeline.phase.taskBreakdown"), () => this.phaseTaskBreakdown(), { phaseId: "taskBreakdown" });

    // Phase 3: 작업 분배
    await this._phase(t("pipeline.phase.assignment"), () => this.phaseAssignment(), { phaseId: "assignment" });

    // Phase 4: 개발
    await this._phase(t("pipeline.phase.development"), () => this.phaseDevelopment(), { phaseId: "development" });

    // Phase 5: 코드 리뷰
    await this._phase(t("pipeline.phase.codeReview"), () => this.phaseCodeReview(), { phaseId: "codeReview" });

    // Phase 6: QA
    await this._phase(t("pipeline.phase.qa"), () => this.phaseQA(), { phaseId: "qa" });

    // Phase 7: PR 생성
    await this._phase(t("pipeline.phase.pr"), () => this.phasePR(), { phaseId: "pr" });

    console.log(chalk.bold.green(`\n${t("pipeline.completed")}\n`));

    // 결정 로그 출력
    const decisionLog = this.interaction.getDecisionLog();
    console.log(chalk.gray(decisionLog));

    // 결정 로그를 GitHub에 기록
    if (this.state.github.planningIssue && process.env.GITHUB_TOKEN) {
      await this.github.addComment(
        this.state.github.planningIssue,
        t("pipeline.pipelineCompleteComment", { mode: this.interaction.mode, log: decisionLog })
      );
      await this.github.closeIssue(this.state.github.planningIssue);
    }
  }

  /**
   * 태스크가 이미지 생성 관련인지 판단
   */
  _isImageTask(task) {
    const keywords = ["이미지", "image", "디자인", "design", "목업", "mockup",
      "아이콘", "icon", "일러스트", "illustrat", "배너", "banner",
      "로고", "logo", "UI", "와이어프레임", "wireframe"];
    const text = `${task.title || ""} ${task.description || ""} ${task.category || ""}`.toLowerCase();
    return keywords.some(kw => text.includes(kw.toLowerCase()));
  }

  _printModelAssignment() {
    const modelColorFn = (key) =>
      key === "claude" ? chalk.hex("#D4A574")
        : key === "gemini" ? chalk.hex("#4285F4")
          : chalk.hex("#10A37F");

    console.log(chalk.bold(t("pipeline.modelAssignment")));
    console.log(chalk.gray("\u2500".repeat(50)));

    for (const agent of this.team.getActiveAgents()) {
      const imageTag = agent.imageModelKey
        ? chalk.gray(` + image:${agent.imageModelKey}`)
        : "";
      console.log(
        `  ${agent.name} (${agent.role}): ${modelColorFn(agent.modelKey)(agent.modelKey)}${imageTag}`
      );
    }

    console.log(chalk.gray("\u2500".repeat(50)) + "\n");
  }

  async _phase(name, fn, { phaseId } = {}) {
    // 이미 완료된 Phase → 스킵
    if (phaseId && this.state.isPhaseComplete(phaseId)) {
      console.log(chalk.gray(`\n${t("pipeline.phaseSkipped", { name })}`));
      return;
    }

    console.log(chalk.bold.yellow(`\n${"═".repeat(60)}`));
    console.log(chalk.bold.yellow(`  ${name}`));
    console.log(chalk.bold.yellow(`${"═".repeat(60)}\n`));

    const execute = async () => {
      try {
        await fn();
        return { skipped: false };
      } catch (error) {
        console.log(chalk.red(`\n${t("pipeline.phaseError", { message: error.message })}`));
        const { action } = await this.interaction.confirmWarning(
          t("pipeline.phaseErrorConfirm", { name, message: error.message }),
          "error"
        );
        if (action === "retry") return execute();
        if (action === "skip") return { skipped: true };
        if (action === "abort") throw new Error("Pipeline aborted by user");
        // proceed: 에러를 무시하고 계속 (Phase는 미완료로 유지)
        return { skipped: true };
      }
    };

    let result = await execute();

    // Phase 전환 확인
    const { action } = await this.interaction.confirmPhaseTransition(
      name,
      t("pipeline.nextPhase")
    );

    if (action === "retry") {
      result = await execute();
    } else if (action === "abort") {
      console.log(chalk.yellow(`\n${t("pipeline.pipelineAborted")}`));
      throw new Error("Pipeline aborted by user");
    }

    // Phase 완료 체크포인트: skip되지 않은 경우에만 기록
    if (phaseId && !result?.skipped) {
      this.state.markPhaseComplete(phaseId);
      await this._saveCheckpoint();
    }
  }

  /**
   * 회의용 스트리밍 콜백 생성 - spinner에 실시간 발언 미리보기 표시
   * 발언 완료 시 내용 미리보기를 영구 출력하여 진행 상황 가시성 확보
   */
  _meetingCallbacks(spinner) {
    let streamBuf = "";
    const cols = () => process.stderr.columns || 80;
    const MAX_PREVIEW_LINES = 5;

    // spinner를 멈추지 않고 텍스트를 영구 출력하는 헬퍼
    // stopAndPersist()+start()는 stdinDiscarder를 토글하여
    // Enter 키 입력 시 스피너 라인이 중복되는 버그를 유발함
    const persist = (symbol, text) => {
      spinner.clear();
      process.stderr.write(`${symbol} ${text}\n`);
      spinner.render();
    };

    const printSpeechPreview = (agent, content, { symbol = chalk.green("✔"), label } = {}) => {
      spinner.clear();
      process.stderr.write(`${symbol} ${label || agent}\n`);
      const lines = content.split("\n").filter((l) => l.trim());
      const preview = lines.slice(0, MAX_PREVIEW_LINES);
      const maxLen = cols() - 4;
      preview.forEach((line) => {
        const truncated = line.length > maxLen ? line.substring(0, maxLen - 1) + "…" : line;
        process.stderr.write(chalk.dim(`  ${truncated}`) + "\n");
      });
      if (lines.length > MAX_PREVIEW_LINES) {
        const omitted = lines.length - MAX_PREVIEW_LINES;
        process.stderr.write(chalk.dim(`  ${t("pipeline.linesOmitted", { count: omitted })}`) + "\n");
      }
      spinner.render();
    };

    return {
      onSpeak: ({ phase, agent, content, round, totalRounds }) => {
        if (phase === "round_start") {
          persist(chalk.cyan("●"), chalk.cyan(t("pipeline.roundLabel", { round, total: totalRounds })));
        } else if (phase === "speaking") {
          streamBuf = "";
          spinner.text = t("pipeline.speaking", { agent });
        } else if (phase === "spoke" && content) {
          printSpeechPreview(agent, content);
        } else if (phase === "passed") {
          persist(chalk.yellow("–"), t("pipeline.passed", { agent }));
        } else if (phase === "empty_response") {
          persist(chalk.yellow("⚠"), t("pipeline.emptyResponse", { agent }));
        } else if (phase === "summary" && content) {
          printSpeechPreview(agent, content, { symbol: chalk.cyan("★"), label: t("pipeline.summary", { agent }) });
        }
      },
      onStream: ({ agent, chunk }) => {
        streamBuf += chunk;
        const lines = streamBuf.split("\n").filter((l) => l.trim());
        const lastLine = lines[lines.length - 1] || "";
        if (lastLine) {
          const prefix = t("pipeline.speaking", { agent }) + " ";
          const maxLen = cols() - prefix.length - 5;
          if (maxLen > 10) {
            spinner.text = prefix + chalk.dim(lastLine.substring(0, maxLen));
          }
        }
      },
    };
  }

  // ─── Phase 0: 코드베이스 분석 (수정 모드) ──────────────

  async phaseCodebaseAnalysis(requirement) {
    const spinner = ora(t("pipeline.codebaseAnalyzing")).start();

    const parts = [];

    // 1. 디렉토리 구조
    const tree = this.workspace.getTree();
    if (tree) {
      parts.push(`## ${t("pipeline.directoryStructure")}\n\`\`\`\n${tree}\n\`\`\``);
    }

    // 2. 요구사항에서 키워드 추출 → 관련 파일 탐색
    const keywords = requirement
      .split(/[\s,./]+/)
      .filter(w => w.length >= 2)
      .slice(0, 10);

    // 2a. 파일명 기반 탐색
    const relevantByName = this.workspace.findRelevantFiles(keywords, {
      maxFiles: 8,
      maxCharsPerFile: 800,
    });

    // 2b. 내용 기반 탐색 (grep)
    const grepResults = [];
    for (const kw of keywords.slice(0, 5)) {
      const hits = this.workspace.grepFiles(kw, { maxResults: 3, contextLines: 2 });
      for (const hit of hits) {
        if (!grepResults.find(r => r.path === hit.path)) {
          grepResults.push(hit);
        }
      }
    }

    if (relevantByName.length > 0) {
      parts.push(`## ${t("pipeline.relevantFilesByName")}\n` + relevantByName.map(
        f => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``
      ).join("\n\n"));
    }

    if (grepResults.length > 0) {
      parts.push(`## ${t("pipeline.relevantCodeBySearch")}\n` + grepResults.slice(0, 8).map(
        r => `### ${r.path}\n\`\`\`\n${r.matches.join("\n")}\n\`\`\``
      ).join("\n\n"));
    }

    const analysis = parts.join("\n\n");
    this.state.codebaseAnalysis = analysis;

    spinner.succeed(t("pipeline.codebaseComplete", { nameCount: relevantByName.length, grepCount: grepResults.length }));
    console.log(chalk.gray(`  ${t("pipeline.codebaseSize", { size: analysis.length })}`));
  }

  // ─── Phase 1: 미팅 ──────────────────────────────────

  async phasePlanning() {
    const spinner = ora(t("pipeline.planningSpinner")).start();

    const requirement = this.state.project.requirement;
    const projectTitle = this.state.project.title;

    const topic = t("agent.planningTopic", { title: projectTitle, requirement });

    const meetingLog = await this.team.conductMeeting(topic, "", {
      rounds: this.config.pipeline?.max_planning_rounds || 2,
      ...this._meetingCallbacks(spinner),
    });

    spinner.succeed(t("pipeline.planningComplete"));

    const markdown = this.team.formatMeetingAsMarkdown(meetingLog);

    // 팀장의 마지막 정리를 설계 결정사항으로 저장
    const lastRound = meetingLog.rounds[meetingLog.rounds.length - 1];
    const summary = lastRound.speeches.find((s) => s.isSummary && !s.isEmpty);
    this.state.designDecisions = summary?.content || markdown;

    console.log(chalk.gray(`\n${t("pipeline.meetingPreview")}`));
    console.log(
      (summary?.content || "").substring(0, 500) + "...\n"
    );

    // GitHub Issue 등록
    const issueSpinner = ora(t("pipeline.githubRegistering")).start();
    const issue = await this.github.createIssue(
      t("pipeline.planningIssueTitle", { title: projectTitle }),
      markdown,
      ["meeting-notes", "planning", "polymeld"]
    );
    this.state.github.planningIssue = issue.number;
    issueSpinner.succeed(t("pipeline.meetingRegistered", { number: issue.number, url: this.github.issueUrl(issue.number) }));
  }

  // ─── Phase 2: 태스크 분해 ─────────────────────────────

  async phaseTaskBreakdown() {
    const spinner = ora(t("pipeline.taskBreakdownSpinner")).start();

    const designDecisions = this.state.designDecisions || "";
    const requirement = this.state.project.requirement || "";

    // 사용 가능한 역할 목록 (ID만 전달하여 AI가 정확한 ID를 반환하도록 유도)
    const availableRoles = Object.keys(this.config.personas || {}).join(", ");

    const result = await this.team.lead.breakdownTasks({
      designDecisions,
      requirement,
      availableRoles,
    });

    spinner.succeed(t("pipeline.taskBreakdownComplete"));

    const parsed = ResponseParser.parseTasks(result.tasks);
    if (!parsed.success) {
      throw new Error(t("pipeline.taskParseFailed", { raw: (result.tasks || "").substring(0, 200) }));
    }
    let tasks = parsed.tasks;

    // 각 태스크에 ID 부여 + suitable_role 정규화 + 의존성 검증
    for (let i = 0; i < tasks.length; i++) {
      tasks[i].id = `task-${i + 1}`;
      tasks[i].suitable_role = this.team.normalizeRole(tasks[i].suitable_role);
      // 의존성 유효성 검증: 유효 범위 외 또는 자기참조 제거
      if (tasks[i].dependencies?.length) {
        tasks[i].dependencies = tasks[i].dependencies.filter(dep => {
          const n = typeof dep === 'number' ? dep : parseInt(dep, 10);
          return !isNaN(n) && n >= 1 && n <= tasks.length && n !== i + 1;
        });
      }
    }

    this.state.tasks = tasks;

    console.log(chalk.green(`\n${t("pipeline.tasksCreated", { count: tasks.length })}\n`));

    // GitHub Issues 생성
    for (const task of tasks) {
      const taskSpinner = ora(t("pipeline.issueCreating", { title: task.title })).start();

      const depText = task.dependencies?.length
        ? task.dependencies.map((d) => `- ${t("pipeline.taskBody.dependencies")} ${d}`).join("\n")
        : t("pipeline.taskBody.noDependencies");

      const body = `${t("pipeline.taskBody.title", { title: task.title })}

${t("pipeline.taskBody.description")}
${task.description}

${t("pipeline.taskBody.suitableRole")}
${task.suitable_role}

${t("pipeline.taskBody.workInfo")}
- ${t("pipeline.taskBody.estimatedHours", { hours: task.estimated_hours })}
- ${t("pipeline.taskBody.priority", { priority: task.priority })}
- ${t("pipeline.taskBody.category", { category: task.category })}

${t("pipeline.taskBody.dependencies")}
${depText}

${t("pipeline.taskBody.acceptanceCriteria")}
${task.acceptance_criteria?.map((c) => `- [ ] ${c}`).join("\n") || "- [ ] TBD"}

---
> ${t("pipeline.taskBody.autoGenerated")} | ${t("pipeline.prBody.planningMeeting")}: #${this.state.github.planningIssue}`;

      const issue = await this.github.createIssue(
        `\uD83D\uDD27 ${task.title}`,
        body,
        ["backlog", "polymeld", task.category || "task"]
      );

      task.issueNumber = issue.number;
      task.nodeId = issue.node_id;

      const projectItem = await this.github.addIssueToProject(issue.node_id, "Backlog");
      task.projectItemId = projectItem?.id;
      taskSpinner.succeed(t("pipeline.issueCreated", { number: issue.number, title: task.title, url: this.github.issueUrl(issue.number) }));
    }
  }

  // ─── Phase 3: 작업 분배 ───────────────────────────────

  async phaseAssignment() {
    console.log(chalk.cyan(`\n${t("pipeline.assignmentHeader")}\n`));

    for (const task of this.state.tasks) {
      const agent = this.team.assignTask(task);
      const reason = t("pipeline.assignReason", { name: agent.name, expertise: agent.expertise.slice(0, 2).join(", ") });

      const comment = t("pipeline.assignComment", { name: agent.name, role: agent.role, model: agent.modelKey, reason });

      await this.github.addComment(task.issueNumber, comment);
      await this.github.updateLabels(
        task.issueNumber,
        ["todo", `assigned:${agent.id}`],
        ["backlog"]
      );
      await this.github.setProjectItemStatus(task.projectItemId, "Todo");

      task.assignedAgent = agent;
      task.assignedAgentId = agent.id;

      this.state.addMessage({
        from: "tech_lead",
        to: agent.id,
        type: "task_assignment",
        content: t("pipeline.assignMessage", { title: task.title, reason }),
        taskId: task.id,
      });

      console.log(
        `  #${task.issueNumber} \u2192 ${chalk.bold(agent.name)} (${agent.modelKey}): ${task.title}`
      );
    }
  }

  // ─── Phase 4: 개발 ───────────────────────────────────

  async phaseDevelopment() {
    const parallelEnabled = this.config.pipeline?.parallel_development !== false;

    // 워크스페이스 트리 캐싱 (Phase 진입 시 1회)
    const treeCache = this.workspace?.isLocal ? this.workspace.getTree() : null;
    // 원본 브랜치 기록 (태스크별 feature 브랜치의 base)
    const baseBranch = this.workspace?.isLocal ? this.workspace.getCurrentBranch() : null;

    // 통합 브랜치: 모든 태스크가 하나의 브랜치에 커밋
    const projectTitle = this.state.project.title || "project";
    const slug = projectTitle.replace(/[^a-zA-Z0-9가-힣]/g, "-").substring(0, 30);
    const issueNum = this.state.github.planningIssue || "0";
    const integrationBranch = `feature/${issueNum}-${slug}`;

    if (!parallelEnabled) {
      // 순차 폴백: 기존 동작과 동일
      for (const task of this.state.tasks) {
        if (!task.assignedAgent || task.code) {
          if (task.code) console.log(chalk.gray(`  ${t("pipeline.devSkipped", { title: task.title })}`));
          continue;
        }
        await this._developTask(task, { treeCache, baseBranch, integrationBranch });
      }
      return;
    }

    // ── 의존성 기반 병렬 실행 ──
    const completedIds = new Set();
    const failedIds = new Set();

    // 재개 시 이미 완료된 태스크 처리
    for (const task of this.state.tasks) {
      if (task.code) {
        console.log(chalk.gray(`  ${t("pipeline.devSkipped", { title: task.title })}`));
        completedIds.add(task.id);
      }
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const readyTasks = this._getReadyTasks(this.state.tasks, completedIds, failedIds);

      if (readyTasks.length === 0) {
        const remaining = this.state.tasks.filter(task =>
          !completedIds.has(task.id) && !failedIds.has(task.id) && task.assignedAgent && !task.code
        );
        if (remaining.length === 0) break;
        // 순환 의존성 또는 실패한 태스크의 후속 작업
        console.log(chalk.yellow(`\n  ${t("pipeline.parallelWaiting", { count: remaining.length })}`));
        for (const task of remaining) {
          await this._developTask(task, { treeCache, baseBranch, integrationBranch });
          completedIds.add(task.id);
        }
        break;
      }

      if (readyTasks.length > 1) {
        console.log(chalk.cyan(
          `\n${t("pipeline.parallelRunning", { count: readyTasks.length, titles: readyTasks.map(task => task.title).join(", ") })}`
        ));
      }

      // LLM 호출 병렬 + Git 작업 큐
      const results = await Promise.allSettled(
        readyTasks.map(task => this._developTask(task, { treeCache, baseBranch, integrationBranch }))
      );

      for (let i = 0; i < readyTasks.length; i++) {
        const task = readyTasks[i];
        const result = results[i];
        if (result.status === "rejected") {
          console.log(chalk.red(`  ${t("pipeline.taskFailed", { title: task.title, reason: result.reason?.message || result.reason })}`));
          failedIds.add(task.id);
        } else {
          completedIds.add(task.id);
        }
      }
    }
  }

  // ─── Phase 5: 코드 리뷰 (실패 시 팀장 직접 수정) ─────────────

  async phaseCodeReview() {
    const lead = this.team.lead;

    for (const task of this.state.tasks) {
      if (!task.code) continue;

      // 재개 시 이미 리뷰 완료된 태스크 스킵
      if (task.reviewApproved != null) {
        console.log(chalk.gray(`  ${t("pipeline.reviewSkipped", { title: task.title })}`));
        continue;
      }

      // 1) 리뷰 실행
      console.log(chalk.cyan(`\n${t("pipeline.reviewLabel", { title: task.title })}`));

      const spinner = ora(
        `  ${t("pipeline.reviewSpinner", { agent: lead.name, model: lead.modelKey })}`
      ).start();
      const reviewBundle = this.assembler.forReview(this.state, { taskId: task.id });
      const result = await lead.reviewCode(reviewBundle, task.assignedAgent?.name || "unknown");
      spinner.succeed(`  ${t("pipeline.reviewComplete")}`);

      task.review = result.review;

      await this.github.addComment(
        task.issueNumber,
        t("pipeline.reviewComment", { agent: lead.name, attempt: 1, max: 1, model: lead.modelKey, review: result.review })
      );

      // 2) 결과 판정
      const needsFix = this._reviewNeedsFix(result.review);
      task.reviewVerdict = needsFix ? "changes_requested" : "approved";

      this.state.addMessage({
        from: "tech_lead",
        to: task.assignedAgentId,
        type: "review_feedback",
        content: result.review,
        taskId: task.id,
      });

      if (!needsFix) {
        // 통과
        task.reviewApproved = true;
        console.log(chalk.green(`  ${t("pipeline.reviewApproved")}`));
        continue;
      }

      // 3) 수정 필요 → 팀장이 직접 수정
      console.log(chalk.yellow(`  ${t("pipeline.reviewChangesRequested", { attempt: 1, max: 1 })}`));

      const fixSpinner = ora(
        `  ${t("pipeline.leadFixSpinner", { agent: lead.name, model: lead.modelKey })}`
      ).start();

      // 리뷰 결과 + 원본 코드를 팀장에게 전달
      const leadFixBundle = {
        systemContext: `${reviewBundle.systemContext}\n\n${t("promptAssembler.reviewFeedback")}\n${result.review}`,
        taskDescription: task.description || "",
        acceptanceCriteria: task.acceptance_criteria?.join("\n") || "",
        currentCode: task.code,
      };
      const preSnapshot = this._takeFileSnapshot();
      const fixResult = await lead.writeCode(leadFixBundle);
      fixSpinner.succeed(`  ${t("pipeline.leadFixComplete", { agent: lead.name })}`);

      if (fixResult) {
        task.code = fixResult.code;
        await this._recommitCode(
          task,
          fixResult.code,
          `fix: lead direct fix for ${task.title} (#${task.issueNumber})`,
          preSnapshot
        );
        await this.github.addComment(
          task.issueNumber,
          t("pipeline.leadFixComment", { agent: lead.name, model: lead.modelKey })
        );
      }

      task.reviewApproved = true;
      console.log(chalk.green(`  ${t("pipeline.reviewApproved")}`));
    }
  }

  // ─── Phase 6: QA (재시도 + fallback 모델 전환) ────────────────

  async phaseQA() {
    const qaAgent = this.team.qa;
    const lead = this.team.lead;
    const maxRetries = this.config.pipeline?.max_qa_retries || 3;
    const fallbackKey = this.config.models?.[qaAgent.modelKey]?.fallback;

    for (const task of this.state.tasks) {
      if (!task.code) continue;

      // 재개 시 이미 QA 완료된 태스크 스킵
      if (task.qaPassed != null) {
        console.log(chalk.gray(`  ${t("pipeline.qaSkipped", { title: task.title })}`));
        continue;
      }

      // 실행 기반 QA 불가 시 스킵 (filePaths 없으면 실행 검증 불가)
      const hasFilePaths = task.filePaths && task.filePaths.length > 0;
      if (!hasFilePaths) {
        console.log(chalk.yellow(`  ${t("pipeline.qaSkippedNoFiles", { title: task.title })}`));
        task.qaPassed = true;
        task.qaAttempts = 0;
        task.qaVerdict = "skipped";
        await this.github.updateLabels(task.issueNumber, ["done"], ["in-review"]);
        await this.github.closeIssue(task.issueNumber);
        this.state.completedTasks.push(task);
        continue;
      }

      await this.github.updateLabels(
        task.issueNumber,
        ["qa"],
        ["in-review"]
      );
      await this.github.setProjectItemStatus(task.projectItemId, "QA");

      this.state.addMessage({
        from: "orchestrator",
        to: "qa",
        type: "qa_request",
        content: t("pipeline.qaRequestMessage", { title: task.title }),
        taskId: task.id,
      });

      let passed = false;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        // ── 모델 결정: 1회차 = 원본, 2회차+ = fallback ──
        const useModelOverride = (attempt >= 2 && fallbackKey) ? fallbackKey : null;
        const currentModel = useModelOverride || qaAgent.modelKey;

        // ── 헤더 출력 ──
        if (attempt === 1) {
          console.log(chalk.cyan(`\n${t("pipeline.qaLabel", { title: task.title })}`));
        } else {
          console.log(chalk.cyan(`\n${t("pipeline.qaRetryLabel", { attempt, max: maxRetries, title: task.title })}`));
          if (attempt === 2 && useModelOverride) {
            console.log(chalk.yellow(`  ${t("pipeline.qaFallbackSwitch", { from: qaAgent.modelKey, to: useModelOverride })}`));
          }
        }

        // ── QA 실행 (try-catch로 타임아웃 포착) ──
        let qaResult = null;
        let qaTimedOut = false;
        let qaErrorMsg = null;
        const qaBundle = this.assembler.forQA(this.state, { taskId: task.id });

        const spinner = ora(
          `  ${t("pipeline.qaSpinner", { agent: qaAgent.name, model: currentModel })}`
        ).start();

        try {
          const result = await qaAgent.runQA(qaBundle, { modelOverride: useModelOverride });
          spinner.succeed(`  ${t("pipeline.qaComplete")}`);
          qaResult = result.qaResult;
        } catch (error) {
          spinner.fail(`  ${t("pipeline.qaComplete")}`);
          console.log(chalk.red(`    ${error.message}`));
          qaTimedOut = true;
          qaErrorMsg = error.message;
        }

        // ── 결과 저장 & GitHub 코멘트 ──
        if (qaResult) {
          task.qa = qaResult;
          await this.github.addComment(
            task.issueNumber,
            t("pipeline.qaComment", { agent: qaAgent.name, attempt, max: maxRetries, model: currentModel, result: qaResult })
          );
        }

        // ── 판정 ──
        const hasFail = qaTimedOut || (qaResult != null && this._qaNeedsFix(qaResult));
        task.qaVerdict = hasFail ? "fail" : "pass";

        this.state.addMessage({
          from: "qa",
          to: task.assignedAgentId,
          type: "qa_result",
          content: qaResult || qaErrorMsg || "QA error",
          taskId: task.id,
        });

        if (!hasFail) {
          // ✅ QA 통과
          task.qaPassed = true;
          task.qaAttempts = attempt;
          console.log(chalk.green(`  ${t("pipeline.qaPassed")}`));
          passed = true;
          break;
        }

        // ❌ QA 실패
        console.log(chalk.yellow(`  ${t("pipeline.qaFailed", { attempt, max: maxRetries })}`));

        // 마지막 시도면 수정 없이 루프 종료
        if (attempt >= maxRetries) break;

        // ── 코드 수정: QA FAIL일 때만 (타임아웃이면 모델만 전환) ──
        if (!qaTimedOut) {
          const fixSpinner = ora(
            `  ${t("pipeline.leadFixSpinner", { agent: lead.name, model: lead.modelKey })}`
          ).start();

          const leadFixBundle = {
            systemContext: `${qaBundle.systemContext}\n\n${t("promptAssembler.qaFeedback")}\n${qaResult}`,
            taskDescription: task.description || "",
            acceptanceCriteria: task.acceptance_criteria?.join("\n") || "",
            currentCode: task.code,
          };
          const preSnapshot = this._takeFileSnapshot();
          const fixResult = await lead.writeCode(leadFixBundle);
          fixSpinner.succeed(`  ${t("pipeline.leadFixComplete", { agent: lead.name })}`);

          if (fixResult) {
            task.code = fixResult.code;
            await this._recommitCode(
              task,
              fixResult.code,
              `fix: lead direct fix for QA feedback on ${task.title} (#${task.issueNumber})`,
              preSnapshot
            );
            await this.github.addComment(
              task.issueNumber,
              t("pipeline.qaFixComment", { agent: lead.name, model: lead.modelKey, attempt })
            );
          }
        }
        // → 다음 attempt (fallback 모델로)
      }

      // ── 모든 시도 소진 시 사용자 확인 ──
      if (!passed) {
        console.log(chalk.yellow(`  ${t("pipeline.qaMaxRetries", { max: maxRetries })}`));

        const { action } = await this.interaction.confirmWarning(
          t("pipeline.qaMaxRetriesConfirm", { title: task.title, max: maxRetries }),
          "warning"
        );

        if (action === "abort") {
          throw new Error("Pipeline aborted by user");
        } else if (action === "skip") {
          await this.github.addComment(
            task.issueNumber,
            t("pipeline.qaSkipComment", { max: maxRetries })
          );
          await this.github.updateLabels(task.issueNumber, [], ["qa"]);
          task.qaPassed = false;
          task.qaAttempts = maxRetries;
          continue; // Done 처리 건너뛰기
        } else {
          // proceed / retry → 재시도 이미 소진되었으므로 현재 상태로 강제 통과
          await this.github.addComment(
            task.issueNumber,
            t("pipeline.qaProceedComment", { max: maxRetries })
          );
          task.qaPassed = true;
          task.qaAttempts = maxRetries;
        }
      }

      // Done 처리
      await this.github.updateLabels(task.issueNumber, ["done"], ["qa"]);
      await this.github.setProjectItemStatus(task.projectItemId, "Done");
      await this.github.closeIssue(task.issueNumber);
      this.state.completedTasks.push(task);
    }
  }

  // ─── 판정 헬퍼 ────────────────────────────────────────

  /**
   * 리뷰 결과에서 수정이 필요한지 판단
   */
  _reviewNeedsFix(review) {
    return ResponseParser.parseReviewVerdict(review).verdict === "CHANGES_REQUESTED";
  }

  _qaNeedsFix(qaResult) {
    return ResponseParser.parseQAVerdict(qaResult).verdict === "FAIL";
  }

  // ─── Phase 7: PR 생성 ────────────────────────────────

  async phasePR() {
    const projectTitle = this.state.project.title || "";
    const tasks = this.state.completedTasks;
    if (tasks.length === 0) return;

    // 통합 브랜치명 (모든 태스크가 동일 브랜치)
    const branchName = tasks[0].branchName;

    // 로컬 워크스페이스: PR 생성 전 push
    if (this.workspace?.isLocal) {
      try {
        this.workspace.gitPush(branchName);
        console.log(chalk.gray(`  ${t("pipeline.pushLog", { branch: branchName })}`));
      } catch (e) {
        console.log(chalk.yellow(`  ${t("pipeline.pushSkipped", { message: e.message })}`));
      }
    }

    const closesIssues = tasks
      .map((task) => `Closes #${task.issueNumber}`)
      .join("\n");
    const taskSummary = tasks
      .map(
        (task) =>
          `- **${task.title}** [${task.category || "feature"}] (${task.assignedAgent?.name} / ${task.assignedAgent?.modelKey})`
      )
      .join("\n");

    const communicationLog = this.state.exportMessageLog();

    const body = `${t("pipeline.prBody.changes")}
${t("pipeline.prBody.implementation", { title: projectTitle })}

${t("pipeline.prBody.relatedIssues")}
${closesIssues}

${t("pipeline.prBody.contents")}

${t("pipeline.prBody.taskList")}
${taskSummary}

${t("pipeline.prBody.reviewHistory")}
${tasks
  .map((task) => {
    const reviewIcon = task.reviewApproved ? t("pipeline.prBody.reviewApproved") : t("pipeline.prBody.reviewConditional");
    const qaIcon = task.qaPassed ? t("pipeline.prBody.qaPassed") : t("pipeline.prBody.qaConditional");
    const qaRetries = task.qaAttempts > 1 ? ` ${t("pipeline.prBody.qaRetries", { count: task.qaAttempts })}` : "";
    return `- **${task.title}**: ${reviewIcon} / QA ${qaIcon}${qaRetries}`;
  })
  .join("\n")}

${t("pipeline.prBody.meetingRecords")}
- ${t("pipeline.prBody.planningMeeting")}: #${this.state.github.planningIssue}

${t("pipeline.prBody.communicationLog")}
${communicationLog}

---
> ${t("pipeline.prBody.autoGenerated")}
>
> ${t("pipeline.prBody.modelAssignment")}
${this.team
  .getActiveAgents()
  .map((a) => `> - ${a.name} (${a.role}): \`${a.modelKey}\``)
  .join("\n")}`;

    const spinner = ora(t("pipeline.prSpinner", { category: projectTitle })).start();
    try {
      const pr = await this.github.createPR(
        `feat: ${projectTitle}`,
        body,
        branchName
      );
      spinner.succeed(t("pipeline.prCreated", { number: pr.number, url: this.github.prUrl(pr.number) }));
    } catch (e) {
      spinner.fail(t("pipeline.prSkipped", { category: projectTitle, message: e.message }));
    }
  }

  async _saveCheckpoint() {
    if (!this.onPhaseSave) return;
    try {
      await this.onPhaseSave();
    } catch (e) {
      console.log(chalk.yellow(`  ${t("pipeline.checkpointFailed", { message: e.message })}`));
    }
  }

  // ─── 재개 헬퍼 ──────────────────────────────────────────

  /**
   * 재개 시 태스크의 assignedAgentId → assignedAgent 참조 복원
   */
  _relinkAgents() {
    // 태스크별 에이전트 참조 재연결
    for (const task of this.state.tasks) {
      if (task.assignedAgentId && typeof task.assignedAgent?.writeCode !== "function") {
        task.assignedAgent = this.team.getAgent(task.assignedAgentId);
        if (!task.assignedAgent) {
          console.log(chalk.yellow(
            `  ${t("pipeline.agentNotFound", { id: task.assignedAgentId, title: task.title })}`
          ));
          task.assignedAgent = this.team.lead;
          task.assignedAgentId = this.team.lead.id;
        }
      }
    }
  }

  // ─── 헬퍼 ─────────────────────────────────────────────

  /** 현재 파일 상태 스냅샷 반환 (pre/post 비교용) */
  _takeFileSnapshot() {
    if (!this.workspace?.isLocal) return null;
    return {
      untracked: new Set(this.workspace.getUntrackedFiles()),
      modified: new Set(this.workspace.getModifiedFiles()),
    };
  }

  /**
   * 개발자에게 수정을 요청하고 결과를 재커밋
   * phaseCodeReview와 phaseQA의 공통 수정 루프에서 사용
   */
  async _applyDevFix(task, { feedbackSource, attempt, labels }) {
    const agent = task.assignedAgent;
    const fixSpinner = ora(
      `  ${t(labels.spinnerStart, { agent: agent?.name, model: agent?.modelKey })}`
    ).start();

    const fixBundle = this.assembler.forFix(this.state, {
      agentId: task.assignedAgentId,
      taskId: task.id,
      feedbackSource,
    });
    const preSnapshot = this._takeFileSnapshot();
    const fixResult = await agent?.writeCode(fixBundle);

    if (fixResult) {
      task.code = fixResult.code;
      await this._recommitCode(
        task,
        fixResult.code,
        `fix: ${feedbackSource} feedback for ${task.title} (#${task.issueNumber})`,
        preSnapshot
      );
      await this.github.addComment(
        task.issueNumber,
        t(labels.commentKey, { agent: agent?.name, model: agent?.modelKey, attempt })
      );
    }

    fixSpinner.succeed(`  ${t(labels.spinnerDone, { agent: agent?.name })}`);
  }

  /**
   * 수정된 코드를 워크스페이스에 재기록 + 재커밋
   * Phase 5(리뷰)/Phase 6(QA) 수정 루프에서 공통 사용
   * @param {Object} [preSnapshot] - 에이전트 호출 전 파일 상태 (_takeFileSnapshot 반환값)
   */
  async _recommitCode(task, rawCode, commitMessage, preSnapshot) {
    if (!this.workspace?.isLocal) return;

    return this._enqueueGit(() => {
      try {
        const EXCLUDE_PATTERNS = [".DS_Store", ".polymeld/"];
        const isExcluded = (f) => EXCLUDE_PATTERNS.some((p) => f.includes(p));

        // 에이전트가 직접 수정한 파일 감지
        let filesToAdd = [];
        if (preSnapshot) {
          const postUntracked = this.workspace.getUntrackedFiles();
          const postModified = this.workspace.getModifiedFiles();
          const newFiles = postUntracked.filter((f) => !preSnapshot.untracked.has(f) && !isExcluded(f));
          const changedFiles = postModified.filter((f) => !preSnapshot.modified.has(f) && !isExcluded(f));
          filesToAdd = [...new Set([...newFiles, ...changedFiles])];
        }

        if (filesToAdd.length > 0) {
          // 에이전트가 직접 생성/수정한 파일: 이미 디스크에 존재
          task.filePaths = filesToAdd;
          task.filePath = filesToAdd[0];
          this.workspace.gitAdd(filesToAdd);
        } else {
          // fallback: 기존 경로에 코드 추출 후 쓰기
          const paths = task.filePaths || (task.filePath ? [task.filePath] : []);
          if (paths.length === 0) return;
          const codeMatch = rawCode.match(/```[\w]*\n([\s\S]*?)```/);
          const cleanCode = codeMatch ? codeMatch[1] : rawCode;
          this.workspace.writeFile(paths[0], cleanCode);
          this.workspace.gitAdd(paths);
        }

        this.workspace.invalidateCache();
        this.workspace.gitCommit(commitMessage);
      } catch (e) {
        console.log(chalk.yellow(`  ${t("pipeline.recommitFailed", { message: e.message })}`));
      }
    });
  }

  /**
   * LLM 응답 텍스트에서 파일 경로를 추출
   * 코드블록 헤더(```lang path) 또는 파일 경로 주석(// path/to/file.ext) 감지
   */
  _parseFilePathsFromResponse(responseText) {
    if (!responseText) return [];
    const paths = new Set();
    const FILE_EXT = /\.(js|ts|jsx|tsx|mjs|cjs|py|go|rs|java|rb|sh|bash|zsh|md|json|yaml|yml|toml|css|scss|html|vue|svelte|c|cpp|h|hpp|cs|swift|kt)$/i;
    // 패턴 1: ```lang filepath (예: ```javascript src/utils/helper.js)
    for (const m of responseText.matchAll(/```\w*\s+([\w./-]+)/g)) {
      if (m[1].includes("/") || FILE_EXT.test(m[1])) {
        paths.add(m[1]);
      }
    }
    // 패턴 2: 코드블록 내 첫 줄 주석 (// path/file.ext 또는 # path/file.ext)
    for (const m of responseText.matchAll(/```\w*\n\s*(?:\/\/|#)\s*([\w./-]+)/g)) {
      if (m[1].includes("/") || FILE_EXT.test(m[1])) {
        paths.add(m[1]);
      }
    }
    return [...paths];
  }

  /**
   * Git 작업을 직렬 큐에 추가하여 순차 실행을 보장
   */
  _enqueueGit(fn) {
    const wrapped = this._gitQueue.then(() => fn());
    this._gitQueue = wrapped.catch(() => {});
    return wrapped;
  }

  /**
   * 의존성이 모두 충족된 실행 가능 태스크 목록 반환
   * 실패한 태스크에 의존하는 태스크는 실행 불가로 처리
   */
  _getReadyTasks(tasks, completedIds, failedIds) {
    return tasks.filter(task => {
      if (completedIds.has(task.id) || failedIds.has(task.id)) return false;
      if (task.code) return false;
      if (!task.assignedAgent) return false;
      const deps = task.dependencies || [];
      return deps.every(depIndex => {
        const depId = typeof depIndex === 'number' ? `task-${depIndex}` : depIndex;
        if (failedIds.has(depId)) return false;
        return completedIds.has(depId);
      });
    });
  }

  /**
   * 개별 태스크 개발 (LLM 호출 + Git 작업)
   * phaseDevelopment에서 병렬/순차 모두에서 사용
   */
  async _developTask(task, { treeCache, baseBranch, integrationBranch }) {
    const agent = task.assignedAgent;
    if (!agent) return;

    console.log(
      chalk.cyan(`\n${t("pipeline.devStart", { agent: agent.name, model: agent.modelKey, title: task.title })}`)
    );

    // GitHub 상태 업데이트
    await this.github.updateLabels(task.issueNumber, ["in-progress"], ["todo"]);
    await this.github.setProjectItemStatus(task.projectItemId, "In Progress");
    await this.github.addComment(
      task.issueNumber,
      t("pipeline.devStartComment", { agent: agent.name, model: agent.modelKey })
    );

    // 통합 브랜치 사용 (모든 태스크가 하나의 브랜치에 커밋)
    const branchName = integrationBranch;
    task.branchName = branchName;

    // 코드베이스 맥락 조립
    let codebaseContext = null;
    if (this.workspace?.isLocal) {
      const relevantFiles = this.workspace.findRelevantFiles(
        [task.title, task.category].filter(Boolean),
      );
      if (treeCache || relevantFiles.length > 0) {
        const parts = [];
        if (treeCache) parts.push(`### ${t("pipeline.directoryStructure")}\n\`\`\`\n${treeCache}\n\`\`\``);
        if (relevantFiles.length > 0) {
          parts.push(`### ${t("pipeline.relevantFiles")}\n` + relevantFiles.map(
            (f) => `=== ${f.path} ===\n${f.content}`
          ).join("\n\n"));
        }
        codebaseContext = parts.join("\n\n");
      }
    }

    // 에이전트 호출 전 파일 상태 스냅샷 (에이전트가 직접 파일을 생성할 수 있으므로)
    const preUntracked = new Set(
      this.workspace?.isLocal ? this.workspace.getUntrackedFiles() : []
    );
    const preModified = new Set(
      this.workspace?.isLocal ? this.workspace.getModifiedFiles() : []
    );

    // LLM 호출 (병렬 실행의 핵심 — 가장 오래 걸리는 구간)
    const spinner = ora(`  ${t("pipeline.codingSpinner", { agent: agent.name })}`).start();
    const contextBundle = this.assembler.forCoding(this.state, { agentId: agent.id, taskId: task.id, codebaseContext });
    const result = await agent.writeCode(contextBundle);
    spinner.succeed(`  ${t("pipeline.codingComplete", { agent: agent.name })}`);

    task.code = result.code;

    // 에이전트가 직접 생성/수정한 파일 감지
    const EXCLUDE_PATTERNS = [".DS_Store", ".polymeld/"];
    const isExcluded = (f) => EXCLUDE_PATTERNS.some((p) => f.includes(p));

    let detectedFiles = [];
    if (this.workspace?.isLocal) {
      const postUntracked = this.workspace.getUntrackedFiles();
      const postModified = this.workspace.getModifiedFiles();
      const newFiles = postUntracked.filter((f) => !preUntracked.has(f) && !isExcluded(f));
      const changedFiles = postModified.filter((f) => !preModified.has(f) && !isExcluded(f));
      detectedFiles = [...new Set([...newFiles, ...changedFiles])];
    }

    // 파일 경로 결정: 감지된 파일 → 응답 파싱 → title 기반 fallback
    if (detectedFiles.length > 0) {
      task.filePaths = detectedFiles;
      task.filePath = detectedFiles[0];
    } else {
      const parsed = this._parseFilePathsFromResponse(result.code);
      if (parsed.length > 0) {
        task.filePaths = parsed;
        task.filePath = parsed[0];
      } else {
        const filePath = `src/${task.category || "feature"}/${task.title
          .replace(/[^a-zA-Z0-9가-힣]/g, "_")
          .replace(/_+/g, "_")
          .replace(/^_|_$/g, "")
          .toLowerCase()}.js`;
        task.filePath = filePath;
        task.filePaths = [filePath];
      }
    }

    // Git 작업: 큐에 넣어 직렬화
    if (this.workspace?.isLocal) {
      await this._enqueueGit(() => {
        try {
          this.workspace.gitCheckoutNewBranch(branchName, baseBranch);

          if (detectedFiles.length > 0) {
            // 에이전트가 직접 생성한 파일: 이미 디스크에 존재
            this.workspace.gitAdd(detectedFiles);
          } else {
            // fallback: 응답 텍스트에서 코드 추출 후 쓰기
            const codeMatch = result.code.match(/```[\w]*\n([\s\S]*?)```/);
            const cleanCode = codeMatch ? codeMatch[1] : result.code;
            this.workspace.writeFile(task.filePath, cleanCode);
            this.workspace.gitAdd([task.filePath]);
          }

          this.workspace.invalidateCache();
          this.workspace.gitCommit(
            `feat: ${task.title} (#${task.issueNumber})\n\nDeveloped by: ${agent.name} (${agent.modelKey})`
          );
          const pathLog = task.filePaths.join(", ");
          console.log(chalk.gray(`  ${t("pipeline.localCommit", { path: pathLog })}`));
        } catch (e) {
          console.log(chalk.yellow(`  ${t("pipeline.localCommitFailed", { message: e.message })}`));
        }
      });
    } else {
      await this._enqueueGit(async () => {
        try {
          if (this.config.pipeline?.auto_branch) {
            await this.github.createBranch(branchName);
          }
          const codeMatch = result.code.match(/```[\w]*\n([\s\S]*?)```/);
          const cleanCode = codeMatch ? codeMatch[1] : result.code;
          await this.github.commitFile(
            branchName,
            task.filePath,
            cleanCode,
            `feat: ${task.title} (#${task.issueNumber})\n\nDeveloped by: ${agent.name} (${agent.modelKey})`
          );
          console.log(chalk.gray(`  ${t("pipeline.commit", { path: task.filePath })}`));
        } catch (e) {
          console.log(chalk.yellow(`  ${t("pipeline.commitSkipped", { message: e.message })}`));
        }
      });
    }

    this.state.addMessage({
      from: agent.id,
      to: "tech_lead",
      type: "review_request",
      content: t("pipeline.devCompleteMessage", { title: task.title }),
      taskId: task.id,
    });

    // 이미지 생성
    if (agent.canGenerateImages && this._isImageTask(task)) {
      const imageSpinner = ora(`  ${t("pipeline.imageSpinner", { agent: agent.name })}`).start();
      try {
        const imageBundle = this.assembler.forImageGeneration(this.state, {
          imagePrompt: task.description || task.title,
          taskId: task.id,
          outputDir: `./output/images/${task.id}`,
        });
        const imageResult = await agent.generateImage(imageBundle);
        imageSpinner.succeed(
          `  ${t("pipeline.imageComplete", { agent: agent.name, count: imageResult.images.length })}`
        );

        task.images = {
          images: imageResult.images,
          text: imageResult.textResponse,
        };

        if (imageResult.images.length > 0) {
          const imageList = imageResult.images.map(img => `- \`${img.path}\``).join("\n");
          await this.github.addComment(
            task.issueNumber,
            t("pipeline.imageComment", { agent: agent.name, model: agent.imageModelKey, imageList, text: imageResult.textResponse || "" })
          );
        }
      } catch (e) {
        imageSpinner.fail(`  ${t("pipeline.imageFailed", { message: e.message })}`);
      }
    }

    // 완료 코멘트
    await this.github.addComment(
      task.issueNumber,
      `${t("pipeline.devCompleteComment", { agent: agent.name, model: agent.modelKey })}\n\n<details>\n<summary>${t("pipeline.codePreviewSummary")}</summary>\n\n${result.code.substring(0, 1000)}${result.code.length > 1000 ? "\n...(truncated)" : ""}\n</details>`
    );

    await this.github.updateLabels(task.issueNumber, ["in-review"], ["in-progress"]);
    await this.github.setProjectItemStatus(task.projectItemId, "In Review");
  }
}
