// src/pipeline/orchestrator.js
// 파이프라인 오케스트레이터 - 전체 Phase를 순서대로 실행
// SharedContext + Mailbox + ContextBuilder 기반 컨텍스트 관리

import chalk from "chalk";
import ora from "ora";
import { InteractionManager } from "../config/interaction.js";

export class PipelineOrchestrator {
  /**
   * @param {import('../agents/team.js').Team} team
   * @param {import('../github/client.js').GitHubClient} github
   * @param {Object} config
   * @param {string} interactionMode
   * @param {Object} contextDeps - 컨텍스트 의존성
   * @param {import('../context/shared-context.js').SharedContext} contextDeps.sharedContext
   * @param {import('../context/mailbox.js').Mailbox} contextDeps.mailbox
   * @param {import('../context/context-builder.js').ContextBuilder} contextDeps.contextBuilder
   */
  constructor(team, github, config, interactionMode = "semi-auto", { sharedContext, mailbox, contextBuilder }) {
    this.team = team;
    this.github = github;
    this.config = config;
    this.shared = sharedContext;
    this.mailbox = mailbox;
    this.contextBuilder = contextBuilder;
    this.interaction = new InteractionManager(interactionMode, {
      timeout: config.pipeline?.auto_timeout || 0,
      defaultYes: true,
    });
    // 시스템 메타데이터만 보유 (GitHub issue numbers 등)
    // LLM 맥락은 SharedContext에서 관리
    this.state = {
      kickoffIssue: null,
      designIssue: null,
      taskIssues: [],        // { issueNumber, nodeId, taskId, assignedAgentId, assignedAgent, ... }
      completedTasks: [],    // { taskId, issueNumber, reviewApproved, qaPassed, qaAttempts }
    };
  }

  async run(requirement, projectTitle) {
    // SharedContext에 프로젝트 정보 저장 (index.js에서 이미 초기화되었을 수 있지만, 안전하게 재설정)
    if (!this.shared.has("project.requirement")) {
      this.shared.set("project.requirement", requirement, {
        author: "orchestrator",
        phase: "init",
        summary: requirement.substring(0, 200),
      });
    }
    if (!this.shared.has("project.title")) {
      this.shared.set("project.title", projectTitle, {
        author: "orchestrator",
        phase: "init",
      });
    }

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
    if (this.state.kickoffIssue && process.env.GITHUB_TOKEN) {
      await this.github.addComment(
        this.state.kickoffIssue,
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
    console.log(chalk.bold("\uD83E\uDD16 모델 배정 현황:"));
    console.log(chalk.gray("\u2500".repeat(50)));
    for (const agent of this.team.getAllAgents()) {
      const modelColor =
        agent.modelKey === "claude"
          ? chalk.hex("#D4A574")
          : agent.modelKey === "gemini"
            ? chalk.hex("#4285F4")
            : chalk.hex("#10A37F");
      const imageTag = agent.imageModelKey
        ? chalk.gray(` + image:${agent.imageModelKey}`)
        : "";
      console.log(
        `  ${agent.name} (${agent.role}): ${modelColor(agent.modelKey)}${imageTag}`
      );
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
        if (action === "abort") process.exit(1);
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
      process.exit(0);
    }
  }

  // ─── Phase 1: 킥오프 미팅 ─────────────────────────────

  async phaseKickoff() {
    const spinner = ora("킥오프 미팅 진행 중...").start();

    const requirement = this.shared.get("project.requirement");
    const projectTitle = this.shared.get("project.title");

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

    // SharedContext에 킥오프 요약 저장
    const lastRound = meetingLog.rounds[meetingLog.rounds.length - 1];
    const summary = lastRound.speeches.find((s) => s.isSummary);
    this.shared.set("meeting.kickoff.summary", summary?.content || "", {
      author: "tech_lead",
      phase: "kickoff",
      summary: summary?.content?.substring(0, 300) || "",
    });

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
    this.state.kickoffIssue = issue.number;
    issueSpinner.succeed(`회의록 등록: #${issue.number}`);

    // 프로젝트에 추가
    await this.github.addIssueToProject(issue.node_id);
  }

  // ─── Phase 2: 기술 설계 미팅 ──────────────────────────

  async phaseDesign() {
    const spinner = ora("기술 설계 미팅 진행 중...").start();

    const requirement = this.shared.get("project.requirement");
    const projectTitle = this.shared.get("project.title");

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

    // 팀장의 마지막 정리를 설계 결정사항으로 SharedContext에 저장
    const lastRound = meetingLog.rounds[meetingLog.rounds.length - 1];
    const summary = lastRound.speeches.find((s) => s.isSummary);
    const designDecisions = summary?.content || markdown;

    this.shared.set("design.decisions", designDecisions, {
      author: "tech_lead",
      phase: "design",
      summary: designDecisions.substring(0, 300),
    });

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
    this.state.designIssue = issue.number;
    issueSpinner.succeed(`설계 문서 등록: #${issue.number}`);
    await this.github.addIssueToProject(issue.node_id);
  }

  // ─── Phase 3: 태스크 분해 ─────────────────────────────

  async phaseTaskBreakdown() {
    const spinner = ora("태스크 분해 중...").start();

    // SharedContext에서 맥락을 가져와 contextBundle 구성
    const designDecisions = this.shared.get("design.decisions") || "";
    const requirement = this.shared.get("project.requirement") || "";

    const result = await this.team.lead.breakdownTasks({
      designDecisions,
      requirement,
    });

    spinner.succeed("태스크 분해 완료");

    // JSON 파싱 시도
    let tasks;
    try {
      const jsonMatch = result.tasks.match(/```json\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : result.tasks;
      const parsed = JSON.parse(jsonStr);
      tasks = parsed.tasks || parsed;
    } catch (e) {
      console.log(chalk.yellow("\u26A0\uFE0F  태스크 JSON 파싱 실패, 원본 텍스트를 사용합니다."));
      console.log(result.tasks);
      return;
    }

    // 각 태스크에 ID 부여
    for (let i = 0; i < tasks.length; i++) {
      tasks[i].id = `task-${i + 1}`;
    }

    // SharedContext에 태스크 목록 저장
    this.shared.set("planning.tasks", tasks, {
      author: "tech_lead",
      phase: "taskBreakdown",
      summary: `${tasks.length}개 태스크`,
    });

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
> \uD83E\uDD16 Agent Team에 의해 자동 생성 | 킥오프: #${this.state.kickoffIssue} | 설계: #${this.state.designIssue}`;

      const issue = await this.github.createIssue(
        `\uD83D\uDD27 ${task.title}`,
        body,
        ["backlog", "agent-team", task.category || "task"]
      );

      this.state.taskIssues.push({
        ...task,
        issueNumber: issue.number,
        nodeId: issue.node_id,
        taskId: task.id,
      });

      await this.github.addIssueToProject(issue.node_id);
      taskSpinner.succeed(`#${issue.number}: ${task.title}`);
    }
  }

  // ─── Phase 4: 작업 분배 ───────────────────────────────

  async phaseAssignment() {
    console.log(chalk.cyan("\n\uD83D\uDC64 팀장이 작업을 분배합니다...\n"));

    const taskAssignment = {};

    for (const task of this.state.taskIssues) {
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
      taskAssignment[task.taskId] = agent.id;

      // Mailbox에 task_assignment 메시지 전송
      this.mailbox.send({
        from: "tech_lead",
        to: agent.id,
        type: "task_assignment",
        payload: {
          content: `태스크 "${task.title}" 배정. ${reason}`,
          taskId: task.taskId,
          taskTitle: task.title,
        },
      });

      console.log(
        `  #${task.issueNumber} \u2192 ${chalk.bold(agent.name)} (${agent.modelKey}): ${task.title}`
      );
    }

    // SharedContext에 배정 정보 저장
    this.shared.set("planning.taskAssignment", taskAssignment, {
      author: "orchestrator",
      phase: "assignment",
      summary: `${Object.keys(taskAssignment).length}개 태스크 배정 완료`,
    });
  }

  // ─── Phase 5: 개발 ───────────────────────────────────

  async phaseDevelopment() {
    for (const task of this.state.taskIssues) {
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

      if (this.config.pipeline?.auto_branch) {
        try {
          await this.github.createBranch(branchName);
        } catch (e) {
          console.log(chalk.yellow(`  \u26A0\uFE0F 브랜치 생성 건너뜀: ${e.message}`));
        }
      }

      // ContextBuilder로 코딩 맥락 조립 (substring() 제거)
      const spinner = ora(`  ${agent.name} 코드 작성 중...`).start();
      const contextBundle = this.contextBuilder.buildForCoding(agent.id, task.taskId);
      const result = await agent.writeCode(contextBundle);
      spinner.succeed(`  ${agent.name} 코드 작성 완료`);

      // 코드를 SharedContext에 저장
      this.shared.set(`code.${task.taskId}`, result.code, {
        author: agent.id,
        phase: "development",
        summary: `${task.title} 구현 코드`,
      });

      // task 메타데이터에도 보관 (GitHub 커밋용)
      task.generatedCode = result.code;

      // 코드를 커밋 (가능한 경우)
      try {
        const filePath = `src/${task.category || "feature"}/${task.title
          .replace(/[^a-zA-Z0-9]/g, "_")
          .toLowerCase()}.js`;

        // 코드블록에서 실제 코드 추출
        const codeMatch = result.code.match(/```[\w]*\n([\s\S]*?)```/);
        const cleanCode = codeMatch ? codeMatch[1] : result.code;

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

      // Mailbox에 리뷰 요청 기록
      this.mailbox.send({
        from: agent.id,
        to: "tech_lead",
        type: "review_request",
        payload: {
          content: `${task.title} 개발 완료. 리뷰를 요청합니다.`,
          taskId: task.taskId,
        },
      });

      // 이미지 생성 (이미지 관련 태스크 && 이미지 모델 보유 에이전트)
      if (agent.canGenerateImages && this._isImageTask(task)) {
        const imageSpinner = ora(`  ${agent.name} 이미지 생성 중...`).start();
        try {
          const imageBundle = this.contextBuilder.buildForImageGeneration(
            agent.id,
            task.description || task.title,
            { taskId: task.taskId, outputDir: `./output/images/${task.taskId}` }
          );
          const imageResult = await agent.generateImage(imageBundle);
          imageSpinner.succeed(
            `  ${agent.name} 이미지 ${imageResult.images.length}개 생성 완료`
          );

          this.shared.set(`image.${task.taskId}`, {
            images: imageResult.images,
            text: imageResult.textResponse,
          }, {
            author: agent.id,
            phase: "development",
            summary: `${task.title} 이미지 ${imageResult.images.length}개 생성`,
          });

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

    for (const task of this.state.taskIssues) {
      if (!this.shared.has(`code.${task.taskId}`)) continue;

      let attempt = 0;
      let approved = false;

      while (!approved && attempt < maxReviewRetries) {
        attempt++;
        const isRetry = attempt > 1;
        const label = isRetry
          ? `\uD83D\uDD0D 팀장 재리뷰 (${attempt}/${maxReviewRetries}): ${task.title}`
          : `\uD83D\uDD0D 팀장 리뷰: ${task.title}`;
        console.log(chalk.cyan(`\n${label}`));

        // 1) ContextBuilder로 리뷰 맥락 조립
        const spinner = ora(
          `  ${lead.name} (${lead.modelKey}) 리뷰 중...`
        ).start();
        const reviewBundle = this.contextBuilder.buildForReview("tech_lead", task.taskId);
        const result = await lead.reviewCode(reviewBundle, task.assignedAgent?.name || "unknown");
        spinner.succeed(`  리뷰 완료`);

        // SharedContext에 리뷰 결과 저장
        this.shared.set(`review.${task.taskId}`, result.review, {
          author: "tech_lead",
          phase: "codeReview",
          summary: result.review.substring(0, 200),
        });

        await this.github.addComment(
          task.issueNumber,
          `\uD83D\uDD0D **${lead.name} 코드 리뷰** [시도 ${attempt}/${maxReviewRetries}] (\`${lead.modelKey}\`):\n\n${result.review}`
        );

        // 2) 결과 판정
        const needsFix = this._reviewNeedsFix(result.review);

        // SharedContext에 verdict 저장
        this.shared.set(`review.${task.taskId}.verdict`, needsFix ? "changes_requested" : "approved", {
          author: "tech_lead",
          phase: "codeReview",
        });

        if (!needsFix) {
          approved = true;
          console.log(chalk.green(`  \u2705 리뷰 통과`));

          // Mailbox에 리뷰 피드백 전송
          this.mailbox.send({
            from: "tech_lead",
            to: task.assignedAgentId,
            type: "review_feedback",
            payload: {
              content: result.review,
              taskId: task.taskId,
              verdict: "approved",
            },
          });
          break;
        }

        console.log(
          chalk.yellow(
            `  \uD83D\uDD04 수정 필요 (시도 ${attempt}/${maxReviewRetries})`
          )
        );

        // Mailbox에 리뷰 피드백 전송 (changes_requested)
        this.mailbox.send({
          from: "tech_lead",
          to: task.assignedAgentId,
          type: "review_feedback",
          payload: {
            content: result.review,
            taskId: task.taskId,
            verdict: "changes_requested",
          },
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

        // 4) 팀장이 수정 방향을 개발자에게 전달 (ContextBuilder 사용)
        const fixSpinner = ora(
          `  ${lead.name} \u2192 ${task.assignedAgent?.name}: 수정 방향 전달 중...`
        ).start();

        const fixGuidanceBundle = this.contextBuilder.buildForReview("tech_lead", task.taskId);
        const fixGuidance = await lead.speak(
          `다음 리뷰에서 수정이 필요합니다. ${task.assignedAgent?.name}에게 구체적인 수정 지시를 작성해주세요.\n\n리뷰 내용:\n${result.review}`,
          fixGuidanceBundle
        );
        fixSpinner.succeed(`  수정 지시 작성 완료`);

        // Mailbox에 수정 지시 전송
        this.mailbox.send({
          from: "tech_lead",
          to: task.assignedAgentId,
          type: "fix_guidance",
          payload: {
            content: fixGuidance.content,
            taskId: task.taskId,
          },
        });

        await this.github.addComment(
          task.issueNumber,
          `\uD83D\uDCAC **${lead.name} \u2192 ${task.assignedAgent?.name}**:\n\n${fixGuidance.content}`
        );

        // 5) 개발자가 수정 (ContextBuilder.buildForFix 사용)
        const devSpinner = ora(
          `  ${task.assignedAgent?.name} (${task.assignedAgent?.modelKey}) 수정 중...`
        ).start();

        const fixBundle = this.contextBuilder.buildForFix(task.assignedAgentId, task.taskId, "review");
        const fixResult = await task.assignedAgent?.writeCode(fixBundle);

        if (fixResult) {
          // 수정된 코드를 SharedContext에 업데이트
          this.shared.set(`code.${task.taskId}`, fixResult.code, {
            author: task.assignedAgentId,
            phase: "development",
            summary: `${task.title} 리뷰 피드백 반영 (시도 ${attempt})`,
          });
          task.generatedCode = fixResult.code;

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

    for (const task of this.state.taskIssues) {
      if (!this.shared.has(`code.${task.taskId}`)) continue;

      await this.github.updateLabels(
        task.issueNumber,
        ["qa"],
        ["in-review"]
      );

      // Mailbox에 QA 요청 전송
      this.mailbox.send({
        from: "orchestrator",
        to: "qa",
        type: "qa_request",
        payload: {
          content: `${task.title} QA 요청`,
          taskId: task.taskId,
        },
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

        // 1) ContextBuilder로 QA 맥락 조립
        const spinner = ora(
          `  ${qaAgent.name} (${qaAgent.modelKey}) 테스트 중...`
        ).start();
        const qaBundle = this.contextBuilder.buildForQA("qa", task.taskId);
        const result = await qaAgent.runQA(qaBundle);
        spinner.succeed(`  QA 완료`);

        // SharedContext에 QA 결과 저장
        this.shared.set(`qa.${task.taskId}`, result.qaResult, {
          author: "qa",
          phase: "qa",
          summary: result.qaResult.substring(0, 200),
        });

        await this.github.addComment(
          task.issueNumber,
          `\uD83E\uDDEA **${qaAgent.name} QA 결과** [시도 ${attempt}/${maxQARetries}] (\`${qaAgent.modelKey}\`):\n\n${result.qaResult}`
        );

        // 2) 결과 판정
        const hasFail = this._qaNeedsFix(result.qaResult);

        // SharedContext에 verdict 저장
        this.shared.set(`qa.${task.taskId}.verdict`, hasFail ? "fail" : "pass", {
          author: "qa",
          phase: "qa",
        });

        if (!hasFail) {
          passed = true;
          console.log(chalk.green(`  \u2705 QA 통과`));

          // Mailbox에 QA 결과 전송
          this.mailbox.send({
            from: "qa",
            to: task.assignedAgentId,
            type: "qa_result",
            payload: {
              content: result.qaResult,
              taskId: task.taskId,
              verdict: "pass",
            },
          });
          break;
        }

        console.log(
          chalk.yellow(
            `  \uD83D\uDD04 QA 실패 - 수정 필요 (시도 ${attempt}/${maxQARetries})`
          )
        );

        // Mailbox에 QA 실패 결과 전송
        this.mailbox.send({
          from: "qa",
          to: task.assignedAgentId,
          type: "qa_result",
          payload: {
            content: result.qaResult,
            taskId: task.taskId,
            verdict: "fail",
          },
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
            process.exit(1);
          }
          // "proceed" -> 실패 상태로 Done 처리
          await this.github.addComment(
            task.issueNumber,
            `\u26A0\uFE0F **시스템**: QA ${maxQARetries}회 실패. 현재 상태로 진행합니다.`
          );
          break;
        }

        // 4) 팀장이 QA 결과를 분석하고 수정 방향 제시 (ContextBuilder 사용)
        const analysisSpinner = ora(
          `  ${lead.name} QA 실패 원인 분석 중...`
        ).start();

        const qaAnalysisBundle = this.contextBuilder.buildForQA("tech_lead", task.taskId);
        const analysis = await lead.speak(
          `QA에서 다음 이슈가 발견되었습니다. 원인을 분석하고 ${task.assignedAgent?.name}에게 구체적인 수정 지시를 작성해주세요.\n\nQA 결과:\n${result.qaResult}`,
          qaAnalysisBundle
        );
        analysisSpinner.succeed(`  원인 분석 완료`);

        // Mailbox에 수정 지시 전송
        this.mailbox.send({
          from: "tech_lead",
          to: task.assignedAgentId,
          type: "fix_guidance",
          payload: {
            content: analysis.content,
            taskId: task.taskId,
          },
        });

        await this.github.addComment(
          task.issueNumber,
          `\uD83D\uDD2C **${lead.name} 분석 & 수정 지시** \u2192 ${task.assignedAgent?.name}:\n\n${analysis.content}`
        );

        // 5) 개발자가 수정 (ContextBuilder.buildForFix 사용)
        const fixSpinner = ora(
          `  ${task.assignedAgent?.name} (${task.assignedAgent?.modelKey}) 수정 중...`
        ).start();

        const fixBundle = this.contextBuilder.buildForFix(task.assignedAgentId, task.taskId, "qa");
        const fixResult = await task.assignedAgent?.writeCode(fixBundle);

        if (fixResult) {
          // 수정된 코드를 SharedContext에 업데이트
          this.shared.set(`code.${task.taskId}`, fixResult.code, {
            author: task.assignedAgentId,
            phase: "development",
            summary: `${task.title} QA 피드백 반영 (시도 ${attempt})`,
          });
          task.generatedCode = fixResult.code;

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
    const lower = review.toLowerCase();
    // "changes requested" 또는 명시적 수정 요청 패턴
    if (lower.includes("changes requested")) return true;
    if (lower.includes("수정 필요") || lower.includes("수정이 필요")) return true;
    if (lower.includes("변경 요청") || lower.includes("개선 필요")) return true;
    // "approved"가 명시적으로 있으면 통과
    if (lower.includes("approved") || lower.includes("승인")) return false;
    // 애매하면 통과 처리 (무한루프 방지)
    return false;
  }

  /**
   * QA 결과에서 실패인지 판단
   */
  _qaNeedsFix(qaResult) {
    const lower = qaResult.toLowerCase();
    // 명시적 FAIL
    if (lower.includes("종합: fail") || lower.includes("종합 판정: fail"))
      return true;
    if (lower.includes("결과: fail") || lower.includes("테스트 실패"))
      return true;
    // 명시적 PASS
    if (lower.includes("종합: pass") || lower.includes("종합 판정: pass"))
      return false;
    if (lower.includes("모든 테스트 통과") || lower.includes("전체 통과"))
      return false;
    // 실패/성공 카운트 비교
    const failCount = (qaResult.match(/\u274C/g) || []).length;
    const passCount = (qaResult.match(/\u2705/g) || []).length;
    if (failCount > 0 && failCount >= passCount) return true;
    // 애매하면 통과
    return false;
  }

  // ─── Phase 8: PR 생성 ────────────────────────────────

  async phasePR() {
    const projectTitle = this.shared.get("project.title") || "";

    // 카테고리별로 그룹화하여 PR 생성
    const groups = {};
    for (const task of this.state.completedTasks) {
      const cat = task.category || "feature";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(task);
    }

    for (const [category, tasks] of Object.entries(groups)) {
      const branchName = `feature/${tasks[0].issueNumber}-${category}`;

      const closesIssues = tasks
        .map((t) => `Closes #${t.issueNumber}`)
        .join("\n");
      const taskSummary = tasks
        .map(
          (t) =>
            `- **${t.title}** (${t.assignedAgent?.name} / ${t.assignedAgent?.modelKey})`
        )
        .join("\n");

      // Mailbox 로그에서 소통 이력 추출
      const communicationLog = this.mailbox.exportLog({
        taskId: tasks[0].taskId,
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
- 킥오프 미팅: #${this.state.kickoffIssue}
- 기술 설계: #${this.state.designIssue}

## 소통 이력
${communicationLog}

---
> \uD83E\uDD16 Agent Team에 의해 자동 생성된 PR
>
> **모델 배정:**
${this.team
  .getAllAgents()
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
}
