// src/pipeline/orchestrator.js
// 파이프라인 오케스트레이터 - 전체 Phase를 순서대로 실행
// PipelineState + PromptAssembler 기반 컨텍스트 관리

import chalk from "chalk";
import ora from "ora";
import { InteractionManager } from "../config/interaction.js";
import { ResponseParser } from "../models/response-parser.js";
import { ModelSelector } from "../models/model-selector.js";

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
  constructor(team, github, config, interactionMode = "semi-auto", { state, assembler, workspace }) {
    this.team = team;
    this.github = github;
    this.config = config;
    this.state = state;
    this.assembler = assembler;
    this.workspace = workspace;
    this.interaction = new InteractionManager(interactionMode, {
      timeout: config.pipeline?.auto_timeout || 0,
      defaultYes: true,
    });
  }

  async run(requirement, projectTitle) {
    // 프로젝트 정보가 없으면 설정 (index.js에서 이미 초기화되었을 수 있음)
    if (!this.state.project.requirement) {
      this.state.project.requirement = requirement;
    }
    if (!this.state.project.title) {
      this.state.project.title = projectTitle;
    }

    // 동적 모델 선택기 초기화
    const available = this.team.adapter.getAvailableModels();
    this.modelSelector = new ModelSelector(this.config, available);

    console.log(chalk.bold.cyan("\n\uD83D\uDE80 Agent Team 파이프라인 시작\n"));
    console.log(chalk.gray(`프로젝트: ${projectTitle}`));
    console.log(chalk.gray(`요구사항: ${requirement}`));
    console.log(chalk.gray(`인터랙션: ${this.interaction.mode}\n`));

    // 모델 배정 현황 출력
    this._printModelAssignment();

    // Phase 1: 킥오프 미팅
    await this._phase("1\uFE0F\u20E3  킥오프 미팅", () => this.phaseKickoff());

    // Phase 2: 기술 설계 미팅
    await this._phase("2\uFE0F\u20E3  기술 설계 미팅", () => this.phaseDesign());

    // Phase 3: 태스크 분해
    await this._phase("3\uFE0F\u20E3  태스크 분해", () => this.phaseTaskBreakdown());

    // Phase 4: 작업 분배
    await this._phase("4\uFE0F\u20E3  작업 분배", () => this.phaseAssignment());

    // Phase 5: 개발
    await this._phase("5\uFE0F\u20E3  개발", () => this.phaseDevelopment());

    // Phase 6: 코드 리뷰
    await this._phase("6\uFE0F\u20E3  코드 리뷰", () => this.phaseCodeReview());

    // Phase 7: QA
    await this._phase("7\uFE0F\u20E3  QA", () => this.phaseQA());

    // Phase 8: PR 생성
    await this._phase("8\uFE0F\u20E3  PR 생성", () => this.phasePR());

    console.log(chalk.bold.green("\n\u2705 파이프라인 완료!\n"));

    // 결정 로그 출력
    const decisionLog = this.interaction.getDecisionLog();
    console.log(chalk.gray(decisionLog));

    // 결정 로그를 GitHub에 기록
    if (this.state.github.kickoffIssue && process.env.GITHUB_TOKEN) {
      await this.github.addComment(
        this.state.github.kickoffIssue,
        `## \uD83E\uDD16 파이프라인 실행 완료\n\n**모드**: \`${this.interaction.mode}\`\n\n${decisionLog}`
      );
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

    console.log(chalk.bold("\uD83E\uDD16 모델 배정 현황:"));
    console.log(chalk.gray("\u2500".repeat(50)));

    // 상시 투입 에이전트
    for (const agent of this.team.getActiveAgents()) {
      const imageTag = agent.imageModelKey
        ? chalk.gray(` + image:${agent.imageModelKey}`)
        : "";
      console.log(
        `  ${agent.name} (${agent.role}): ${modelColorFn(agent.modelKey)(agent.modelKey)}${imageTag}`
      );
    }

    // 온디맨드 대기 에이전트 (소집 전이므로 onDemand 전원 표시)
    const onDemandAgents = this.team.getAllAgents().filter(a => a.onDemand);
    if (onDemandAgents.length > 0) {
      console.log(chalk.gray("  \u2500\u2500 \uC628\uB514\uB9E8\uB4DC (\uD544\uC694 \uC2DC \uC18C\uC9D1) \u2500\u2500"));
      for (const agent of onDemandAgents) {
        console.log(chalk.gray(`  ${agent.name} (${agent.role}): ${agent.modelKey} [\uB300\uAE30]`));
      }
    }

    console.log(chalk.gray("\u2500".repeat(50)) + "\n");
  }

  async _phase(name, fn) {
    console.log(chalk.bold.yellow(`\n${"═".repeat(60)}`));
    console.log(chalk.bold.yellow(`  ${name}`));
    console.log(chalk.bold.yellow(`${"═".repeat(60)}\n`));

    const execute = async () => {
      try {
        await fn();
      } catch (error) {
        console.log(chalk.red(`\n\u274C 에러 발생: ${error.message}`));
        const { action } = await this.interaction.confirmWarning(
          `${name}에서 에러 발생: ${error.message}`,
          "error"
        );
        if (action === "retry") return execute();
        if (action === "skip") return;
        if (action === "abort") throw new Error("Pipeline aborted by user");
      }
    };

    await execute();

    // Phase 전환 확인
    const { action } = await this.interaction.confirmPhaseTransition(
      name,
      "다음 Phase"
    );

    if (action === "retry") {
      await execute();
    } else if (action === "abort") {
      console.log(chalk.yellow("\n\u23F9\uFE0F  파이프라인 중단"));
      throw new Error("Pipeline aborted by user");
    }
  }

  // ─── Phase 1: 킥오프 미팅 ─────────────────────────────

  async phaseKickoff() {
    const spinner = ora("킥오프 미팅 진행 중...").start();

    const requirement = this.state.project.requirement;
    const projectTitle = this.state.project.title;

    const meetingLog = await this.team.conductMeeting(
      requirement,
      `프로젝트: ${projectTitle}`,
      {
        rounds: 2,
        onSpeak: ({ phase, agent }) => {
          if (phase === "speaking") {
            spinner.text = `${agent} 발언 중...`;
          }
        },
      }
    );

    spinner.succeed("킥오프 미팅 완료");

    // 킥오프 요약 저장
    const lastRound = meetingLog.rounds[meetingLog.rounds.length - 1];
    const summary = lastRound.speeches.find((s) => s.isSummary);
    this.state.kickoffSummary = summary?.content || "";

    // 마크다운 생성
    const markdown = this.team.formatMeetingAsMarkdown(meetingLog, "kickoff");
    console.log(chalk.gray("\n--- 회의록 미리보기 ---"));
    console.log(markdown.substring(0, 500) + "...\n");

    // GitHub Issue 등록
    const issueSpinner = ora("GitHub에 회의록 등록 중...").start();
    const issue = await this.github.createIssue(
      `\uD83D\uDCCB 킥오프 미팅: ${projectTitle}`,
      markdown,
      ["meeting-notes", "kickoff", "agent-team"]
    );
    this.state.github.kickoffIssue = issue.number;
    issueSpinner.succeed(`회의록 등록: #${issue.number}`);

    // 프로젝트에 추가
    await this.github.addIssueToProject(issue.node_id);
  }

  // ─── Phase 2: 기술 설계 미팅 ──────────────────────────

  async phaseDesign() {
    const spinner = ora("기술 설계 미팅 진행 중...").start();

    const requirement = this.state.project.requirement;
    const projectTitle = this.state.project.title;

    const topic = `프로젝트 "${projectTitle}"의 기술 설계를 논의합니다.

## 요구사항
${requirement}

## 논의 사항
1. 기술 스택 선정 (언어, 프레임워크, DB 등)
2. 시스템 아키텍처 (모놀리식 vs 마이크로서비스 등)
3. API 설계 방향
4. 프론트엔드 구조
5. 배포 전략
6. 테스트 전략

각자의 전문 영역에서 구체적인 제안을 해주세요. 의견이 다르면 반박하고 대안을 제시하세요.`;

    const meetingLog = await this.team.conductMeeting(topic, "", {
      rounds: this.config.pipeline?.max_discussion_rounds || 3,
      onSpeak: ({ phase, agent }) => {
        if (phase === "speaking") spinner.text = `${agent} 발언 중...`;
      },
    });

    spinner.succeed("기술 설계 미팅 완료");

    const markdown = this.team.formatMeetingAsMarkdown(meetingLog, "design");

    // 팀장의 마지막 정리를 설계 결정사항으로 저장
    const lastRound = meetingLog.rounds[meetingLog.rounds.length - 1];
    const summary = lastRound.speeches.find((s) => s.isSummary);
    this.state.designDecisions = summary?.content || markdown;

    console.log(chalk.gray("\n--- 설계 결정 미리보기 ---"));
    console.log(
      (summary?.content || "").substring(0, 500) + "...\n"
    );

    const issueSpinner = ora("GitHub에 설계 문서 등록 중...").start();
    const issue = await this.github.createIssue(
      `\uD83C\uDFD7\uFE0F 기술 설계: ${projectTitle}`,
      markdown,
      ["meeting-notes", "design", "agent-team"]
    );
    this.state.github.designIssue = issue.number;
    issueSpinner.succeed(`설계 문서 등록: #${issue.number}`);
    await this.github.addIssueToProject(issue.node_id);
  }

  // ─── Phase 3: 태스크 분해 ─────────────────────────────

  async phaseTaskBreakdown() {
    const spinner = ora("태스크 분해 중...").start();

    const designDecisions = this.state.designDecisions || "";
    const requirement = this.state.project.requirement || "";

    // 사용 가능한 역할 목록 동적 생성
    const availableRoles = Object.entries(this.config.personas)
      .map(([id, p]) => `${id}(${p.role})`)
      .join(", ");

    const modelOverride = this.modelSelector.selectModel({
      operation: "breakdownTasks",
      agentDefault: this.team.lead.modelKey,
    });
    const result = await this.team.lead.breakdownTasks({
      designDecisions,
      requirement,
      availableRoles,
    }, { modelOverride });

    spinner.succeed("태스크 분해 완료");

    const parsed = ResponseParser.parseTasks(result.tasks);
    if (!parsed.success) {
      console.log(chalk.yellow("\u26A0\uFE0F  태스크 JSON 파싱 실패, 원본 텍스트를 사용합니다."));
      console.log(result.tasks);
      return;
    }
    let tasks = parsed.tasks;

    // 각 태스크에 ID 부여
    for (let i = 0; i < tasks.length; i++) {
      tasks[i].id = `task-${i + 1}`;
    }

    // 온디맨드 페르소나 소집: suitable_role 분석
    const requiredRoles = [...new Set(tasks.map(t => t.suitable_role))];
    const toMobilize = requiredRoles.filter(role => {
      const agent = this.team.getAgent(role);
      return agent && agent.onDemand;
    });

    if (toMobilize.length > 0) {
      this.team.mobilize(toMobilize);

      this.state.mobilizedAgents = toMobilize;

      const names = toMobilize.map(id => {
        const a = this.team.getAgent(id);
        return `${a.name}(${a.role})`;
      }).join(", ");
      console.log(chalk.cyan(`\n\uD83D\uDCE2 \uC628\uB514\uB9E8\uB4DC \uC18C\uC9D1: ${names}`));
    }

    this.state.tasks = tasks;

    console.log(chalk.green(`\n\uD83D\uDCCB ${tasks.length}개 태스크 생성됨:\n`));

    // GitHub Issues 생성
    for (const task of tasks) {
      const taskSpinner = ora(`이슈 생성: ${task.title}`).start();

      const body = `## \uD83D\uDD27 ${task.title}

### 설명
${task.description}

### 담당 적합 역할
${task.suitable_role}

### 작업 정보
- **예상 소요**: ${task.estimated_hours}h
- **우선순위**: ${task.priority}
- **카테고리**: ${task.category}

### 의존성
${task.dependencies?.length ? task.dependencies.map((d) => `- #${d}`).join("\n") : "없음"}

### 수용 기준
${task.acceptance_criteria?.map((c) => `- [ ] ${c}`).join("\n") || "- [ ] TBD"}

---
> \uD83E\uDD16 Agent Team에 의해 자동 생성 | 킥오프: #${this.state.github.kickoffIssue} | 설계: #${this.state.github.designIssue}`;

      const issue = await this.github.createIssue(
        `\uD83D\uDD27 ${task.title}`,
        body,
        ["backlog", "agent-team", task.category || "task"]
      );

      task.issueNumber = issue.number;
      task.nodeId = issue.node_id;

      await this.github.addIssueToProject(issue.node_id);
      taskSpinner.succeed(`#${issue.number}: ${task.title}`);
    }
  }

  // ─── Phase 4: 작업 분배 ───────────────────────────────

  async phaseAssignment() {
    console.log(chalk.cyan("\n\uD83D\uDC64 팀장이 작업을 분배합니다...\n"));

    for (const task of this.state.tasks) {
      const agent = this.team.assignTask(task);
      const reason = `${agent.name}의 전문 영역(${agent.expertise.slice(0, 2).join(", ")})이 이 태스크에 적합`;

      const comment = `\uD83D\uDC64 **팀장 배정 메모**: **${agent.name}** (${agent.role}, \`${agent.modelKey}\` 모델)에게 배정합니다.\n\n**이유**: ${reason}`;

      await this.github.addComment(task.issueNumber, comment);
      await this.github.updateLabels(
        task.issueNumber,
        ["todo", `assigned:${agent.id}`],
        ["backlog"]
      );

      task.assignedAgent = agent;
      task.assignedAgentId = agent.id;

      this.state.addMessage({
        from: "tech_lead",
        to: agent.id,
        type: "task_assignment",
        content: `태스크 "${task.title}" 배정. ${reason}`,
        taskId: task.id,
      });

      console.log(
        `  #${task.issueNumber} \u2192 ${chalk.bold(agent.name)} (${agent.modelKey}): ${task.title}`
      );
    }
  }

  // ─── Phase 5: 개발 ───────────────────────────────────

  async phaseDevelopment() {
    // 워크스페이스 트리 캐싱 (Phase 진입 시 1회)
    const treeCache = this.workspace?.isLocal ? this.workspace.getTree() : null;
    // 원본 브랜치 기록 (태스크별 feature 브랜치의 base)
    const baseBranch = this.workspace?.isLocal ? this.workspace.getCurrentBranch() : null;

    for (const task of this.state.tasks) {
      const agent = task.assignedAgent;
      if (!agent) continue;

      console.log(
        chalk.cyan(`\n\uD83D\uDD28 ${agent.name} (${agent.modelKey})이 개발 시작: ${task.title}`)
      );

      // 상태 업데이트: In Progress
      await this.github.updateLabels(
        task.issueNumber,
        ["in-progress"],
        ["todo"]
      );
      await this.github.addComment(
        task.issueNumber,
        `\uD83D\uDE80 **${agent.name}** (\`${agent.modelKey}\`): 개발을 시작합니다.`
      );

      // 브랜치 생성
      const branchName = `feature/${task.issueNumber}-${task.title
        .replace(/[^a-zA-Z0-9가-힣]/g, "-")
        .substring(0, 30)}`;
      task.branchName = branchName;

      if (this.workspace?.isLocal) {
        try {
          this.workspace.gitCheckoutNewBranch(branchName, baseBranch);
        } catch (e) {
          console.log(chalk.yellow(`  \u26A0\uFE0F 로컬 브랜치 생성 건너뜀: ${e.message}`));
        }
      } else if (this.config.pipeline?.auto_branch) {
        try {
          await this.github.createBranch(branchName);
        } catch (e) {
          console.log(chalk.yellow(`  \u26A0\uFE0F 브랜치 생성 건너뜀: ${e.message}`));
        }
      }

      // 코드베이스 맥락 조립 (워크스페이스 연동 시)
      let codebaseContext = null;
      if (this.workspace?.isLocal) {
        const relevantFiles = this.workspace.findRelevantFiles(
          [task.title, task.category].filter(Boolean),
        );
        if (treeCache || relevantFiles.length > 0) {
          const parts = [];
          if (treeCache) parts.push(`### 디렉토리 구조\n\`\`\`\n${treeCache}\n\`\`\``);
          if (relevantFiles.length > 0) {
            parts.push("### 관련 파일\n" + relevantFiles.map(
              (f) => `=== ${f.path} ===\n${f.content}`
            ).join("\n\n"));
          }
          codebaseContext = parts.join("\n\n");
        }
      }

      // PromptAssembler로 코딩 맥락 조립
      const spinner = ora(`  ${agent.name} 코드 작성 중...`).start();
      const contextBundle = this.assembler.forCoding(this.state, { agentId: agent.id, taskId: task.id, codebaseContext });
      const codeModelOverride = this.modelSelector.selectModel({
        operation: "writeCode",
        agentDefault: agent.modelKey,
      });
      const result = await agent.writeCode(contextBundle, { modelOverride: codeModelOverride });
      spinner.succeed(`  ${agent.name} 코드 작성 완료`);

      // 코드를 태스크에 저장
      task.code = result.code;

      // 파일 경로 생성 및 저장
      const filePath = `src/${task.category || "feature"}/${task.title
        .replace(/[^a-zA-Z0-9]/g, "_")
        .toLowerCase()}.js`;
      task.filePath = filePath;

      // 코드블록에서 실제 코드 추출
      const codeMatch = result.code.match(/```[\w]*\n([\s\S]*?)```/);
      const cleanCode = codeMatch ? codeMatch[1] : result.code;

      // 코드 저장: 로컬 워크스페이스 우선, 없으면 GitHub API
      if (this.workspace?.isLocal) {
        try {
          this.workspace.writeFile(filePath, cleanCode);
          this.workspace.invalidateCache();
          this.workspace.gitAdd([filePath]);
          this.workspace.gitCommit(
            `feat: ${task.title} (#${task.issueNumber})\n\nDeveloped by: ${agent.name} (${agent.modelKey})`
          );
          console.log(chalk.gray(`  \uD83D\uDCC1 로컬 커밋: ${filePath}`));
        } catch (e) {
          console.log(chalk.yellow(`  \u26A0\uFE0F 로컬 커밋 실패: ${e.message}`));
        }
      } else {
        try {
          await this.github.commitFile(
            branchName,
            filePath,
            cleanCode,
            `feat: ${task.title} (#${task.issueNumber})\n\nDeveloped by: ${agent.name} (${agent.modelKey})`
          );
          console.log(chalk.gray(`  \uD83D\uDCC1 커밋: ${filePath}`));
        } catch (e) {
          console.log(chalk.yellow(`  \u26A0\uFE0F 커밋 건너뜀: ${e.message}`));
        }
      }

      this.state.addMessage({
        from: agent.id,
        to: "tech_lead",
        type: "review_request",
        content: `${task.title} 개발 완료. 리뷰를 요청합니다.`,
        taskId: task.id,
      });

      // 이미지 생성 (이미지 관련 태스크 && 이미지 모델 보유 에이전트)
      if (agent.canGenerateImages && this._isImageTask(task)) {
        const imageSpinner = ora(`  ${agent.name} 이미지 생성 중...`).start();
        try {
          const imageBundle = this.assembler.forImageGeneration(this.state, {
            imagePrompt: task.description || task.title,
            taskId: task.id,
            outputDir: `./output/images/${task.id}`,
          });
          const imageResult = await agent.generateImage(imageBundle);
          imageSpinner.succeed(
            `  ${agent.name} 이미지 ${imageResult.images.length}개 생성 완료`
          );

          task.images = {
            images: imageResult.images,
            text: imageResult.textResponse,
          };

          if (imageResult.images.length > 0) {
            const imageList = imageResult.images.map(img => `- \`${img.path}\``).join("\n");
            await this.github.addComment(
              task.issueNumber,
              `🎨 **${agent.name}** (\`${agent.imageModelKey}\`): 이미지 생성 완료\n\n${imageList}\n\n${imageResult.textResponse || ""}`
            );
          }
        } catch (e) {
          imageSpinner.fail(`  이미지 생성 실패: ${e.message}`);
        }
      }

      // 완료 코멘트
      await this.github.addComment(
        task.issueNumber,
        `\u2705 **${agent.name}** (\`${agent.modelKey}\`): 개발 완료. 리뷰를 요청합니다.\n\n<details>\n<summary>생성된 코드 미리보기</summary>\n\n${result.code.substring(0, 1000)}${result.code.length > 1000 ? "\n...(truncated)" : ""}\n</details>`
      );

      await this.github.updateLabels(
        task.issueNumber,
        ["in-review"],
        ["in-progress"]
      );
    }
  }

  // ─── Phase 6: 코드 리뷰 (수정 루프 포함) ─────────────

  async phaseCodeReview() {
    const lead = this.team.lead;
    const maxReviewRetries = this.config.pipeline?.max_review_retries ?? 3;

    for (const task of this.state.tasks) {
      if (!task.code) continue;

      let attempt = 0;
      let approved = false;

      while (!approved && attempt < maxReviewRetries) {
        attempt++;
        const isRetry = attempt > 1;
        const label = isRetry
          ? `\uD83D\uDD0D 팀장 재리뷰 (${attempt}/${maxReviewRetries}): ${task.title}`
          : `\uD83D\uDD0D 팀장 리뷰: ${task.title}`;
        console.log(chalk.cyan(`\n${label}`));

        // 1) PromptAssembler로 리뷰 맥락 조립
        const spinner = ora(
          `  ${lead.name} (${lead.modelKey}) 리뷰 중...`
        ).start();
        const reviewBundle = this.assembler.forReview(this.state, { taskId: task.id });
        const reviewModelOverride = this.modelSelector.selectModel({
          operation: "reviewCode",
          agentDefault: lead.modelKey,
        });
        const result = await lead.reviewCode(reviewBundle, task.assignedAgent?.name || "unknown", { modelOverride: reviewModelOverride });
        spinner.succeed(`  리뷰 완료`);

        // 리뷰 결과를 태스크에 저장
        task.review = result.review;

        await this.github.addComment(
          task.issueNumber,
          `\uD83D\uDD0D **${lead.name} 코드 리뷰** [시도 ${attempt}/${maxReviewRetries}] (\`${lead.modelKey}\`):\n\n${result.review}`
        );

        // 2) 결과 판정
        const needsFix = this._reviewNeedsFix(result.review);

        task.reviewVerdict = needsFix ? "changes_requested" : "approved";

        if (!needsFix) {
          approved = true;
          console.log(chalk.green(`  \u2705 리뷰 통과`));

          this.state.addMessage({
            from: "tech_lead",
            to: task.assignedAgentId,
            type: "review_feedback",
            content: result.review,
            taskId: task.id,
          });
          break;
        }

        console.log(
          chalk.yellow(
            `  \uD83D\uDD04 수정 필요 (시도 ${attempt}/${maxReviewRetries})`
          )
        );

        this.state.addMessage({
          from: "tech_lead",
          to: task.assignedAgentId,
          type: "review_feedback",
          content: result.review,
          taskId: task.id,
        });

        // 3) 마지막 시도였으면 루프 탈출
        if (attempt >= maxReviewRetries) {
          console.log(
            chalk.red(
              `  \u26A0\uFE0F  최대 리뷰 재시도 횟수(${maxReviewRetries}) 도달`
            )
          );
          await this.github.addComment(
            task.issueNumber,
            `\u26A0\uFE0F **시스템**: 코드 리뷰 재시도 ${maxReviewRetries}회 도달. 현재 상태로 QA 진행합니다.`
          );
          break;
        }

        // 4) 팀장이 수정 방향을 개발자에게 전달
        const fixSpinner = ora(
          `  ${lead.name} \u2192 ${task.assignedAgent?.name}: 수정 방향 전달 중...`
        ).start();

        const fixGuidanceBundle = this.assembler.forReview(this.state, { taskId: task.id });
        const fixGuidance = await lead.speak(
          `다음 리뷰에서 수정이 필요합니다. ${task.assignedAgent?.name}에게 구체적인 수정 지시를 작성해주세요.\n\n리뷰 내용:\n${result.review}`,
          fixGuidanceBundle
        );
        fixSpinner.succeed(`  수정 지시 작성 완료`);

        this.state.addMessage({
          from: "tech_lead",
          to: task.assignedAgentId,
          type: "fix_guidance",
          content: fixGuidance.content,
          taskId: task.id,
        });

        await this.github.addComment(
          task.issueNumber,
          `\uD83D\uDCAC **${lead.name} \u2192 ${task.assignedAgent?.name}**:\n\n${fixGuidance.content}`
        );

        // 5) 개발자가 수정
        const devSpinner = ora(
          `  ${task.assignedAgent?.name} (${task.assignedAgent?.modelKey}) 수정 중...`
        ).start();

        const fixBundle = this.assembler.forFix(this.state, { agentId: task.assignedAgentId, taskId: task.id, feedbackSource: "review" });
        const fixModelOverride = this.modelSelector.selectModel({
          operation: "writeCode",
          agentDefault: task.assignedAgent?.modelKey,
        });
        const fixResult = await task.assignedAgent?.writeCode(fixBundle, { modelOverride: fixModelOverride });

        if (fixResult) {
          task.code = fixResult.code;

          // 수정된 코드를 워크스페이스에 재커밋
          this._recommitCode(task, fixResult.code, `fix: review feedback for ${task.title} (#${task.issueNumber})`);

          await this.github.addComment(
            task.issueNumber,
            `\uD83D\uDD04 **${task.assignedAgent?.name}** (\`${task.assignedAgent?.modelKey}\`): 리뷰 피드백 반영 완료 (시도 ${attempt})`
          );
        }
        devSpinner.succeed(
          `  ${task.assignedAgent?.name} 수정 완료 \u2192 재리뷰 진행`
        );
      }

      task.reviewApproved = approved;
    }
  }

  // ─── Phase 7: QA (수정 루프 포함) ─────────────────────

  async phaseQA() {
    const qaAgent = this.team.qa;
    const lead = this.team.lead;
    const maxQARetries = this.config.pipeline?.max_qa_retries ?? 3;

    for (const task of this.state.tasks) {
      if (!task.code) continue;

      await this.github.updateLabels(
        task.issueNumber,
        ["qa"],
        ["in-review"]
      );

      this.state.addMessage({
        from: "orchestrator",
        to: "qa",
        type: "qa_request",
        content: `${task.title} QA 요청`,
        taskId: task.id,
      });

      let attempt = 0;
      let passed = false;

      while (!passed && attempt < maxQARetries) {
        attempt++;
        const isRetry = attempt > 1;
        const label = isRetry
          ? `\uD83E\uDDEA QA 재검증 (${attempt}/${maxQARetries}): ${task.title}`
          : `\uD83E\uDDEA QA 검증: ${task.title}`;
        console.log(chalk.cyan(`\n${label}`));

        // 1) PromptAssembler로 QA 맥락 조립
        const spinner = ora(
          `  ${qaAgent.name} (${qaAgent.modelKey}) 테스트 중...`
        ).start();
        const qaBundle = this.assembler.forQA(this.state, { taskId: task.id });
        const qaModelOverride = this.modelSelector.selectModel({
          operation: "runQA",
          agentDefault: qaAgent.modelKey,
        });
        const result = await qaAgent.runQA(qaBundle, { modelOverride: qaModelOverride });
        spinner.succeed(`  QA 완료`);

        // QA 결과를 태스크에 저장
        task.qa = result.qaResult;

        await this.github.addComment(
          task.issueNumber,
          `\uD83E\uDDEA **${qaAgent.name} QA 결과** [시도 ${attempt}/${maxQARetries}] (\`${qaAgent.modelKey}\`):\n\n${result.qaResult}`
        );

        // 2) 결과 판정
        const hasFail = this._qaNeedsFix(result.qaResult);

        task.qaVerdict = hasFail ? "fail" : "pass";

        if (!hasFail) {
          passed = true;
          console.log(chalk.green(`  \u2705 QA 통과`));

          this.state.addMessage({
            from: "qa",
            to: task.assignedAgentId,
            type: "qa_result",
            content: result.qaResult,
            taskId: task.id,
          });
          break;
        }

        console.log(
          chalk.yellow(
            `  \uD83D\uDD04 QA 실패 - 수정 필요 (시도 ${attempt}/${maxQARetries})`
          )
        );

        this.state.addMessage({
          from: "qa",
          to: task.assignedAgentId,
          type: "qa_result",
          content: result.qaResult,
          taskId: task.id,
        });

        // 3) 마지막 시도면 루프 탈출
        if (attempt >= maxQARetries) {
          console.log(
            chalk.red(
              `  \u26A0\uFE0F  최대 QA 재시도 횟수(${maxQARetries}) 도달`
            )
          );

          // 사용자에게 최종 결정 요청
          const { action } = await this.interaction.confirmWarning(
            `${task.title}: QA ${maxQARetries}회 실패. 어떻게 처리할까요?`,
            "error"
          );

          if (action === "skip") {
            await this.github.addComment(
              task.issueNumber,
              `\u26A0\uFE0F **시스템**: QA ${maxQARetries}회 실패. 사용자 결정으로 건너뜁니다.`
            );
            break;
          } else if (action === "abort") {
            throw new Error("Pipeline aborted by user");
          }
          // "proceed" -> 실패 상태로 Done 처리
          await this.github.addComment(
            task.issueNumber,
            `\u26A0\uFE0F **시스템**: QA ${maxQARetries}회 실패. 현재 상태로 진행합니다.`
          );
          break;
        }

        // 4) 팀장이 QA 결과를 분석하고 수정 방향 제시
        const analysisSpinner = ora(
          `  ${lead.name} QA 실패 원인 분석 중...`
        ).start();

        const qaAnalysisBundle = this.assembler.forQA(this.state, { taskId: task.id });
        const analysis = await lead.speak(
          `QA에서 다음 이슈가 발견되었습니다. 원인을 분석하고 ${task.assignedAgent?.name}에게 구체적인 수정 지시를 작성해주세요.\n\nQA 결과:\n${result.qaResult}`,
          qaAnalysisBundle
        );
        analysisSpinner.succeed(`  원인 분석 완료`);

        this.state.addMessage({
          from: "tech_lead",
          to: task.assignedAgentId,
          type: "fix_guidance",
          content: analysis.content,
          taskId: task.id,
        });

        await this.github.addComment(
          task.issueNumber,
          `\uD83D\uDD2C **${lead.name} 분석 & 수정 지시** \u2192 ${task.assignedAgent?.name}:\n\n${analysis.content}`
        );

        // 5) 개발자가 수정
        const fixSpinner = ora(
          `  ${task.assignedAgent?.name} (${task.assignedAgent?.modelKey}) 수정 중...`
        ).start();

        const fixBundle = this.assembler.forFix(this.state, { agentId: task.assignedAgentId, taskId: task.id, feedbackSource: "qa" });
        const qaFixModelOverride = this.modelSelector.selectModel({
          operation: "writeCode",
          agentDefault: task.assignedAgent?.modelKey,
        });
        const fixResult = await task.assignedAgent?.writeCode(fixBundle, { modelOverride: qaFixModelOverride });

        if (fixResult) {
          task.code = fixResult.code;

          // 수정된 코드를 워크스페이스에 재커밋
          this._recommitCode(task, fixResult.code, `fix: QA feedback for ${task.title} (#${task.issueNumber})`);

          await this.github.addComment(
            task.issueNumber,
            `\uD83D\uDD04 **${task.assignedAgent?.name}** (\`${task.assignedAgent?.modelKey}\`): QA 피드백 반영 완료 (시도 ${attempt})`
          );
        }
        fixSpinner.succeed(
          `  ${task.assignedAgent?.name} 수정 완료 \u2192 재테스트 진행`
        );
      }

      // Done 처리
      task.qaPassed = passed;
      task.qaAttempts = attempt;
      await this.github.updateLabels(task.issueNumber, ["done"], ["qa"]);
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

  // ─── Phase 8: PR 생성 ────────────────────────────────

  async phasePR() {
    const projectTitle = this.state.project.title || "";

    // 카테고리별로 그룹화하여 PR 생성
    const groups = {};
    for (const task of this.state.completedTasks) {
      const cat = task.category || "feature";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(task);
    }

    for (const [category, tasks] of Object.entries(groups)) {
      // 태스크에 저장된 branchName 사용, 없으면 기존 방식 폴백
      const branchName = tasks[0].branchName || `feature/${tasks[0].issueNumber}-${category}`;

      // 로컬 워크스페이스: PR 생성 전 push
      if (this.workspace?.isLocal) {
        try {
          this.workspace.gitPush(branchName);
          console.log(chalk.gray(`  📤 push: ${branchName}`));
        } catch (e) {
          console.log(chalk.yellow(`  ⚠️ push 건너뜀: ${e.message}`));
        }
      }

      const closesIssues = tasks
        .map((t) => `Closes #${t.issueNumber}`)
        .join("\n");
      const taskSummary = tasks
        .map(
          (t) =>
            `- **${t.title}** (${t.assignedAgent?.name} / ${t.assignedAgent?.modelKey})`
        )
        .join("\n");

      const communicationLog = this.state.exportMessageLog({
        taskId: tasks[0].id,
      });

      const body = `## 변경 사항
${projectTitle} - ${category} 구현

## 관련 이슈
${closesIssues}

## 구현 내용

### 태스크 목록
${taskSummary}

## 리뷰 & QA 이력
${tasks
  .map((t) => {
    const reviewIcon = t.reviewApproved ? "\u2705 Approved" : "\u26A0\uFE0F 조건부 통과";
    const qaIcon = t.qaPassed ? "\u2705 Passed" : "\u26A0\uFE0F 조건부 통과";
    const qaRetries = t.qaAttempts > 1 ? ` (${t.qaAttempts}회 시도)` : "";
    return `- **${t.title}**: 리뷰 ${reviewIcon} / QA ${qaIcon}${qaRetries}`;
  })
  .join("\n")}

## 관련 회의/논의 기록
- 킥오프 미팅: #${this.state.github.kickoffIssue}
- 기술 설계: #${this.state.github.designIssue}

## 소통 이력
${communicationLog}

---
> \uD83E\uDD16 Agent Team에 의해 자동 생성된 PR
>
> **모델 배정:**
${this.team
  .getActiveAgents()
  .map((a) => `> - ${a.name} (${a.role}): \`${a.modelKey}\``)
  .join("\n")}`;

      try {
        const spinner = ora(`PR 생성: ${category}`).start();
        const pr = await this.github.createPR(
          `feat: ${projectTitle} - ${category}`,
          body,
          branchName
        );
        spinner.succeed(`PR #${pr.number} 생성 완료`);
      } catch (e) {
        console.log(
          chalk.yellow(`  \u26A0\uFE0F PR 생성 건너뜀 (${category}): ${e.message}`)
        );
      }
    }
  }

  // ─── 헬퍼 ─────────────────────────────────────────────

  /**
   * 수정된 코드를 워크스페이스에 재기록 + 재커밋
   * Phase 6(리뷰)/Phase 7(QA) 수정 루프에서 공통 사용
   */
  _recommitCode(task, rawCode, commitMessage) {
    if (!this.workspace?.isLocal || !task.filePath) return;
    try {
      const codeMatch = rawCode.match(/```[\w]*\n([\s\S]*?)```/);
      const cleanCode = codeMatch ? codeMatch[1] : rawCode;
      this.workspace.writeFile(task.filePath, cleanCode);
      this.workspace.gitAdd([task.filePath]);
      this.workspace.gitCommit(commitMessage);
    } catch (e) {
      console.log(chalk.yellow(`  ⚠️ 재커밋 실패: ${e.message}`));
    }
  }
}
