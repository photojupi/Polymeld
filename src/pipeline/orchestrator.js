// src/pipeline/orchestrator.js
// 파이프라인 오케스트레이터 - 전체 Phase를 순서대로 실행

import chalk from "chalk";
import ora from "ora";
import { InteractionManager } from "../config/interaction.js";

export class PipelineOrchestrator {
  constructor(team, github, config, interactionMode = "semi-auto") {
    this.team = team;
    this.github = github;
    this.config = config;
    this.interaction = new InteractionManager(interactionMode, {
      timeout: config.pipeline?.auto_timeout || 0,
      defaultYes: true,
    });
    this.state = {
      requirement: "",
      projectTitle: "",
      kickoffIssue: null,
      designIssue: null,
      designDecisions: "",
      tasks: [],
      taskIssues: [],
      completedTasks: [],
    };
  }

  async run(requirement, projectTitle) {
    this.state.requirement = requirement;
    this.state.projectTitle = projectTitle;

    console.log(chalk.bold.cyan("\n🚀 Agent Team 파이프라인 시작\n"));
    console.log(chalk.gray(`프로젝트: ${projectTitle}`));
    console.log(chalk.gray(`요구사항: ${requirement}`));
    console.log(chalk.gray(`인터랙션: ${this.interaction.mode}\n`));

    // 모델 배정 현황 출력
    this._printModelAssignment();

    // Phase 1: 킥오프 미팅
    await this._phase("1️⃣  킥오프 미팅", () => this.phaseKickoff());

    // Phase 2: 기술 설계 미팅
    await this._phase("2️⃣  기술 설계 미팅", () => this.phaseDesign());

    // Phase 3: 태스크 분해
    await this._phase("3️⃣  태스크 분해", () => this.phaseTaskBreakdown());

    // Phase 4: 작업 분배
    await this._phase("4️⃣  작업 분배", () => this.phaseAssignment());

    // Phase 5: 개발
    await this._phase("5️⃣  개발", () => this.phaseDevelopment());

    // Phase 6: 코드 리뷰
    await this._phase("6️⃣  코드 리뷰", () => this.phaseCodeReview());

    // Phase 7: QA
    await this._phase("7️⃣  QA", () => this.phaseQA());

    // Phase 8: PR 생성
    await this._phase("8️⃣  PR 생성", () => this.phasePR());

    console.log(chalk.bold.green("\n✅ 파이프라인 완료!\n"));

    // 결정 로그 출력
    const decisionLog = this.interaction.getDecisionLog();
    console.log(chalk.gray(decisionLog));

    // 결정 로그를 GitHub에 기록
    if (this.state.kickoffIssue && process.env.GITHUB_TOKEN) {
      await this.github.addComment(
        this.state.kickoffIssue,
        `## 🤖 파이프라인 실행 완료\n\n**모드**: \`${this.interaction.mode}\`\n\n${decisionLog}`
      );
    }
  }

  _printModelAssignment() {
    console.log(chalk.bold("🤖 모델 배정 현황:"));
    console.log(chalk.gray("─".repeat(50)));
    for (const agent of this.team.getAllAgents()) {
      const modelColor =
        agent.modelKey === "claude"
          ? chalk.hex("#D4A574")
          : agent.modelKey === "gemini"
            ? chalk.hex("#4285F4")
            : chalk.hex("#10A37F");
      console.log(
        `  ${agent.name} (${agent.role}): ${modelColor(agent.modelKey)}`
      );
    }
    console.log(chalk.gray("─".repeat(50)) + "\n");
  }

  async _phase(name, fn) {
    console.log(chalk.bold.yellow(`\n${"═".repeat(60)}`));
    console.log(chalk.bold.yellow(`  ${name}`));
    console.log(chalk.bold.yellow(`${"═".repeat(60)}\n`));

    const execute = async () => {
      try {
        await fn();
      } catch (error) {
        console.log(chalk.red(`\n❌ 에러 발생: ${error.message}`));
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
      console.log(chalk.yellow("\n⏹️  파이프라인 중단"));
      process.exit(0);
    }
  }

  // ─── Phase 1: 킥오프 미팅 ─────────────────────────────

  async phaseKickoff() {
    const spinner = ora("킥오프 미팅 진행 중...").start();

    const meetingLog = await this.team.conductMeeting(
      this.state.requirement,
      `프로젝트: ${this.state.projectTitle}`,
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

    // 마크다운 생성
    const markdown = this.team.formatMeetingAsMarkdown(meetingLog, "kickoff");
    console.log(chalk.gray("\n--- 회의록 미리보기 ---"));
    console.log(markdown.substring(0, 500) + "...\n");

    // GitHub Issue 등록
    const issueSpinner = ora("GitHub에 회의록 등록 중...").start();
    const issue = await this.github.createIssue(
      `📋 킥오프 미팅: ${this.state.projectTitle}`,
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

    const topic = `프로젝트 "${this.state.projectTitle}"의 기술 설계를 논의합니다.

## 요구사항
${this.state.requirement}

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
      `🏗️ 기술 설계: ${this.state.projectTitle}`,
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

    const result = await this.team.lead.breakdownTasks(
      this.state.designDecisions,
      this.state.requirement
    );

    spinner.succeed("태스크 분해 완료");

    // JSON 파싱 시도
    let tasks;
    try {
      const jsonMatch = result.tasks.match(/```json\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : result.tasks;
      const parsed = JSON.parse(jsonStr);
      tasks = parsed.tasks || parsed;
    } catch (e) {
      console.log(chalk.yellow("⚠️  태스크 JSON 파싱 실패, 원본 텍스트를 사용합니다."));
      console.log(result.tasks);
      return;
    }

    this.state.tasks = tasks;
    console.log(chalk.green(`\n📋 ${tasks.length}개 태스크 생성됨:\n`));

    // GitHub Issues 생성
    for (const task of tasks) {
      const taskSpinner = ora(`이슈 생성: ${task.title}`).start();

      const body = `## 🔧 ${task.title}

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
> 🤖 Agent Team에 의해 자동 생성 | 킥오프: #${this.state.kickoffIssue} | 설계: #${this.state.designIssue}`;

      const issue = await this.github.createIssue(
        `🔧 ${task.title}`,
        body,
        ["backlog", "agent-team", task.category || "task"]
      );

      this.state.taskIssues.push({
        ...task,
        issueNumber: issue.number,
        nodeId: issue.node_id,
      });

      await this.github.addIssueToProject(issue.node_id);
      taskSpinner.succeed(`#${issue.number}: ${task.title}`);
    }
  }

  // ─── Phase 4: 작업 분배 ───────────────────────────────

  async phaseAssignment() {
    console.log(chalk.cyan("\n👤 팀장이 작업을 분배합니다...\n"));

    for (const task of this.state.taskIssues) {
      const agent = this.team.assignTask(task);
      const reason = `${agent.name}의 전문 영역(${agent.expertise.slice(0, 2).join(", ")})이 이 태스크에 적합`;

      const comment = `👤 **팀장 배정 메모**: **${agent.name}** (${agent.role}, \`${agent.modelKey}\` 모델)에게 배정합니다.\n\n**이유**: ${reason}`;

      await this.github.addComment(task.issueNumber, comment);
      await this.github.updateLabels(
        task.issueNumber,
        ["todo", `assigned:${agent.id}`],
        ["backlog"]
      );

      task.assignedAgent = agent;
      console.log(
        `  #${task.issueNumber} → ${chalk.bold(agent.name)} (${agent.modelKey}): ${task.title}`
      );
    }
  }

  // ─── Phase 5: 개발 ───────────────────────────────────

  async phaseDevelopment() {
    for (const task of this.state.taskIssues) {
      const agent = task.assignedAgent;
      if (!agent) continue;

      console.log(
        chalk.cyan(`\n🔨 ${agent.name} (${agent.modelKey})이 개발 시작: ${task.title}`)
      );

      // 상태 업데이트: In Progress
      await this.github.updateLabels(
        task.issueNumber,
        ["in-progress"],
        ["todo"]
      );
      await this.github.addComment(
        task.issueNumber,
        `🚀 **${agent.name}** (\`${agent.modelKey}\`): 개발을 시작합니다.`
      );

      // 브랜치 생성
      const branchName = `feature/${task.issueNumber}-${task.title
        .replace(/[^a-zA-Z0-9가-힣]/g, "-")
        .substring(0, 30)}`;

      if (this.config.pipeline?.auto_branch) {
        try {
          await this.github.createBranch(branchName);
        } catch (e) {
          console.log(chalk.yellow(`  ⚠️ 브랜치 생성 건너뜀: ${e.message}`));
        }
      }

      // 코드 작성
      const spinner = ora(`  ${agent.name} 코드 작성 중...`).start();
      const result = await agent.writeCode(
        task.description,
        this.state.designDecisions.substring(0, 2000),
        task.acceptance_criteria?.join("\n") || ""
      );
      spinner.succeed(`  ${agent.name} 코드 작성 완료`);

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
        console.log(chalk.gray(`  📁 커밋: ${filePath}`));
      } catch (e) {
        console.log(chalk.yellow(`  ⚠️ 커밋 건너뜀: ${e.message}`));
      }

      // 완료 코멘트
      await this.github.addComment(
        task.issueNumber,
        `✅ **${agent.name}** (\`${agent.modelKey}\`): 개발 완료. 리뷰를 요청합니다.\n\n<details>\n<summary>생성된 코드 미리보기</summary>\n\n${result.code.substring(0, 1000)}${result.code.length > 1000 ? "\n...(truncated)" : ""}\n</details>`
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
      if (!task.generatedCode) continue;

      let attempt = 0;
      let approved = false;

      while (!approved && attempt < maxReviewRetries) {
        attempt++;
        const isRetry = attempt > 1;
        const label = isRetry
          ? `🔍 팀장 재리뷰 (${attempt}/${maxReviewRetries}): ${task.title}`
          : `🔍 팀장 리뷰: ${task.title}`;
        console.log(chalk.cyan(`\n${label}`));

        // 1) 팀장 리뷰
        const spinner = ora(
          `  ${lead.name} (${lead.modelKey}) 리뷰 중...`
        ).start();
        const result = await lead.reviewCode(
          task.generatedCode,
          task.acceptance_criteria?.join("\n") || "",
          task.assignedAgent?.name || "unknown"
        );
        spinner.succeed(`  리뷰 완료`);

        task.reviewResult = result.review;

        await this.github.addComment(
          task.issueNumber,
          `🔍 **${lead.name} 코드 리뷰** [시도 ${attempt}/${maxReviewRetries}] (\`${lead.modelKey}\`):\n\n${result.review}`
        );

        // 2) 결과 판정
        const needsFix = this._reviewNeedsFix(result.review);

        if (!needsFix) {
          approved = true;
          console.log(chalk.green(`  ✅ 리뷰 통과`));
          break;
        }

        console.log(
          chalk.yellow(
            `  🔄 수정 필요 (시도 ${attempt}/${maxReviewRetries})`
          )
        );

        // 3) 마지막 시도였으면 루프 탈출
        if (attempt >= maxReviewRetries) {
          console.log(
            chalk.red(
              `  ⚠️  최대 리뷰 재시도 횟수(${maxReviewRetries}) 도달`
            )
          );
          await this.github.addComment(
            task.issueNumber,
            `⚠️ **시스템**: 코드 리뷰 재시도 ${maxReviewRetries}회 도달. 현재 상태로 QA 진행합니다.`
          );
          break;
        }

        // 4) 팀장이 수정 방향을 개발자에게 전달
        const fixSpinner = ora(
          `  ${lead.name} → ${task.assignedAgent?.name}: 수정 방향 전달 중...`
        ).start();

        const fixGuidance = await lead.speak(
          `다음 리뷰에서 수정이 필요합니다. ${task.assignedAgent?.name}에게 구체적인 수정 지시를 작성해주세요.\n\n리뷰 내용:\n${result.review}`,
          `원본 코드:\n${task.generatedCode?.substring(0, 1500)}`
        );
        fixSpinner.succeed(`  수정 지시 작성 완료`);

        await this.github.addComment(
          task.issueNumber,
          `💬 **${lead.name} → ${task.assignedAgent?.name}**:\n\n${fixGuidance.content}`
        );

        // 5) 개발자가 수정
        const devSpinner = ora(
          `  ${task.assignedAgent?.name} (${task.assignedAgent?.modelKey}) 수정 중...`
        ).start();

        const fixResult = await task.assignedAgent?.writeCode(
          `팀장(${lead.name})의 리뷰 피드백과 수정 지시를 반영하여 코드를 수정해주세요.

## 팀장 리뷰
${result.review}

## 팀장 수정 지시
${fixGuidance.content}

## 현재 코드
${task.generatedCode}

수정된 전체 코드를 작성해주세요.`,
          this.state.designDecisions.substring(0, 1500),
          task.acceptance_criteria?.join("\n") || ""
        );

        if (fixResult) {
          task.generatedCode = fixResult.code;
          await this.github.addComment(
            task.issueNumber,
            `🔄 **${task.assignedAgent?.name}** (\`${task.assignedAgent?.modelKey}\`): 리뷰 피드백 반영 완료 (시도 ${attempt})`
          );
        }
        devSpinner.succeed(
          `  ${task.assignedAgent?.name} 수정 완료 → 재리뷰 진행`
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
      if (!task.generatedCode) continue;

      await this.github.updateLabels(
        task.issueNumber,
        ["qa"],
        ["in-review"]
      );

      let attempt = 0;
      let passed = false;

      while (!passed && attempt < maxQARetries) {
        attempt++;
        const isRetry = attempt > 1;
        const label = isRetry
          ? `🧪 QA 재검증 (${attempt}/${maxQARetries}): ${task.title}`
          : `🧪 QA 검증: ${task.title}`;
        console.log(chalk.cyan(`\n${label}`));

        // 1) QA 테스트
        const spinner = ora(
          `  ${qaAgent.name} (${qaAgent.modelKey}) 테스트 중...`
        ).start();
        const result = await qaAgent.runQA(
          task.generatedCode,
          task.acceptance_criteria?.join("\n") || "",
          task.description
        );
        spinner.succeed(`  QA 완료`);

        task.qaResult = result.qaResult;

        await this.github.addComment(
          task.issueNumber,
          `🧪 **${qaAgent.name} QA 결과** [시도 ${attempt}/${maxQARetries}] (\`${qaAgent.modelKey}\`):\n\n${result.qaResult}`
        );

        // 2) 결과 판정
        const hasFail = this._qaNeedsFix(result.qaResult);

        if (!hasFail) {
          passed = true;
          console.log(chalk.green(`  ✅ QA 통과`));
          break;
        }

        console.log(
          chalk.yellow(
            `  🔄 QA 실패 - 수정 필요 (시도 ${attempt}/${maxQARetries})`
          )
        );

        // 3) 마지막 시도면 루프 탈출
        if (attempt >= maxQARetries) {
          console.log(
            chalk.red(
              `  ⚠️  최대 QA 재시도 횟수(${maxQARetries}) 도달`
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
              `⚠️ **시스템**: QA ${maxQARetries}회 실패. 사용자 결정으로 건너뜁니다.`
            );
            break;
          } else if (action === "abort") {
            process.exit(1);
          }
          // "proceed" → 실패 상태로 Done 처리
          await this.github.addComment(
            task.issueNumber,
            `⚠️ **시스템**: QA ${maxQARetries}회 실패. 현재 상태로 진행합니다.`
          );
          break;
        }

        // 4) 팀장이 QA 결과를 분석하고 수정 방향 제시
        const analysisSpinner = ora(
          `  ${lead.name} QA 실패 원인 분석 중...`
        ).start();

        const analysis = await lead.speak(
          `QA에서 다음 이슈가 발견되었습니다. 원인을 분석하고 ${task.assignedAgent?.name}에게 구체적인 수정 지시를 작성해주세요.

## QA 결과
${result.qaResult}

## 현재 코드
${task.generatedCode?.substring(0, 2000)}

## 수용 기준
${task.acceptance_criteria?.join("\n") || "없음"}`,
          ""
        );
        analysisSpinner.succeed(`  원인 분석 완료`);

        await this.github.addComment(
          task.issueNumber,
          `🔬 **${lead.name} 분석 & 수정 지시** → ${task.assignedAgent?.name}:\n\n${analysis.content}`
        );

        // 5) 개발자가 수정
        const fixSpinner = ora(
          `  ${task.assignedAgent?.name} (${task.assignedAgent?.modelKey}) 수정 중...`
        ).start();

        const fixResult = await task.assignedAgent?.writeCode(
          `QA 테스트에서 실패했습니다. 팀장의 분석과 수정 지시를 반영하여 코드를 수정해주세요.

## QA 실패 내용
${result.qaResult}

## 팀장 분석 & 수정 지시
${analysis.content}

## 현재 코드
${task.generatedCode}

수정된 전체 코드를 작성해주세요.`,
          this.state.designDecisions.substring(0, 1500),
          task.acceptance_criteria?.join("\n") || ""
        );

        if (fixResult) {
          task.generatedCode = fixResult.code;
          await this.github.addComment(
            task.issueNumber,
            `🔄 **${task.assignedAgent?.name}** (\`${task.assignedAgent?.modelKey}\`): QA 피드백 반영 완료 (시도 ${attempt})`
          );
        }
        fixSpinner.succeed(
          `  ${task.assignedAgent?.name} 수정 완료 → 재테스트 진행`
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
    // ❌ 카운트가 ✅보다 많으면 실패
    const failCount = (qaResult.match(/❌/g) || []).length;
    const passCount = (qaResult.match(/✅/g) || []).length;
    if (failCount > 0 && failCount >= passCount) return true;
    // 애매하면 통과
    return false;
  }

  // ─── Phase 8: PR 생성 ────────────────────────────────

  async phasePR() {
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

      const body = `## 변경 사항
${this.state.projectTitle} - ${category} 구현

## 관련 이슈
${closesIssues}

## 구현 내용

### 태스크 목록
${taskSummary}

## 리뷰 & QA 이력
${tasks
  .map((t) => {
    const reviewIcon = t.reviewApproved ? "✅ Approved" : "⚠️ 조건부 통과";
    const qaIcon = t.qaPassed ? "✅ Passed" : "⚠️ 조건부 통과";
    const qaRetries = t.qaAttempts > 1 ? ` (${t.qaAttempts}회 시도)` : "";
    return `- **${t.title}**: 리뷰 ${reviewIcon} / QA ${qaIcon}${qaRetries}`;
  })
  .join("\n")}

## 관련 회의/논의 기록
- 킥오프 미팅: #${this.state.kickoffIssue}
- 기술 설계: #${this.state.designIssue}

---
> 🤖 Agent Team에 의해 자동 생성된 PR
> 
> **모델 배정:**
${this.team
  .getAllAgents()
  .map((a) => `> - ${a.name} (${a.role}): \`${a.modelKey}\``)
  .join("\n")}`;

      try {
        const spinner = ora(`PR 생성: ${category}`).start();
        const pr = await this.github.createPR(
          `feat: ${this.state.projectTitle} - ${category}`,
          body,
          branchName
        );
        spinner.succeed(`PR #${pr.number} 생성 완료`);
      } catch (e) {
        console.log(
          chalk.yellow(`  ⚠️ PR 생성 건너뜀 (${category}): ${e.message}`)
        );
      }
    }
  }
}
