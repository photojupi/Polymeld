// src/pipeline/phases/planning.js
// Phase 0-3: 코드베이스 분석, 미팅, 태스크 분해, 작업 분배

import chalk from "chalk";
import ora from "ora";
import { ResponseParser } from "../../models/response-parser.js";
import { t } from "../../i18n/index.js";
import { formatMetaLine, printMeta } from "../helpers.js";

/**
 * 회의용 스트리밍 콜백 생성 - spinner에 실시간 발언 미리보기 표시
 */
function meetingCallbacks(spinner) {
  let streamBuf = "";
  const cols = () => process.stderr.columns || 80;
  const MAX_PREVIEW_LINES = 5;

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
    onSpeak: ({ phase, agent, content, round, totalRounds, meta }) => {
      if (phase === "round_start") {
        persist(chalk.cyan("●"), chalk.cyan(t("pipeline.roundLabel", { round, total: totalRounds })));
      } else if (phase === "speaking") {
        streamBuf = "";
        spinner.text = t("pipeline.speaking", { agent });
      } else if (phase === "spoke" && content) {
        printSpeechPreview(agent, content);
        if (meta) { const ml = formatMetaLine(meta); if (ml) { spinner.clear(); process.stderr.write(ml + "\n"); spinner.render(); } }
      } else if (phase === "passed") {
        persist(chalk.yellow("–"), t("pipeline.passed", { agent }));
        if (meta) { const ml = formatMetaLine(meta); if (ml) { spinner.clear(); process.stderr.write(ml + "\n"); spinner.render(); } }
      } else if (phase === "empty_response") {
        persist(chalk.yellow("⚠"), t("pipeline.emptyResponse", { agent }));
      } else if (phase === "summary" && content) {
        printSpeechPreview(agent, content, { symbol: chalk.cyan("★"), label: t("pipeline.summary", { agent }) });
        if (meta) { const ml = formatMetaLine(meta); if (ml) { spinner.clear(); process.stderr.write(ml + "\n"); spinner.render(); } }
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

// ─── Phase 0: 코드베이스 분석 ─────────────────────────

export async function phaseCodebaseAnalysis(ctx, requirement) {
  const spinner = ora(t("pipeline.codebaseAnalyzing")).start();

  const parts = [];

  // 1. 디렉토리 구조
  const tree = ctx.workspace.getTree();
  if (tree) {
    parts.push(`## ${t("pipeline.directoryStructure")}\n\`\`\`\n${tree}\n\`\`\``);
  }

  // 2. 요구사항에서 키워드 추출 → 관련 파일 탐색
  const keywords = requirement
    .split(/[\s,./]+/)
    .filter(w => w.length >= 2)
    .slice(0, 10);

  // 2a. 파일명 기반 탐색
  const relevantByName = ctx.workspace.findRelevantFiles(keywords, {
    maxFiles: 8,
    maxCharsPerFile: 800,
  });

  // 2b. 내용 기반 탐색 (grep)
  const grepResults = [];
  for (const kw of keywords.slice(0, 5)) {
    const hits = ctx.workspace.grepFiles(kw, { maxResults: 3, contextLines: 2 });
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
  ctx.state.codebaseAnalysis = analysis;

  spinner.succeed(t("pipeline.codebaseComplete", { nameCount: relevantByName.length, grepCount: grepResults.length }));
  console.log(chalk.gray(`  ${t("pipeline.codebaseSize", { size: analysis.length })}`));
}

// ─── Phase 1: 미팅 ──────────────────────────────────

export async function phasePlanning(ctx) {
  const spinner = ora(t("pipeline.planningSpinner")).start();

  const requirement = ctx.state.project.requirement;
  const projectTitle = ctx.state.project.title;

  const topic = t("agent.planningTopic", { title: projectTitle, requirement });

  const meetingLog = await ctx.team.conductMeeting(topic, "", {
    rounds: ctx.config.pipeline?.max_planning_rounds || 3,
    ...meetingCallbacks(spinner),
  });

  spinner.succeed(t("pipeline.planningComplete"));

  const markdown = ctx.team.formatMeetingAsMarkdown(meetingLog);

  // 팀장의 마지막 정리를 설계 결정사항으로 저장
  const lastRound = meetingLog.rounds[meetingLog.rounds.length - 1];
  const summary = lastRound.speeches.find((s) => s.isSummary && !s.isEmpty);
  ctx.state.designDecisions = summary?.content || markdown;

  console.log(chalk.gray(`\n${t("pipeline.meetingPreview")}`));
  console.log(
    (summary?.content || "").substring(0, 500) + "...\n"
  );

  // GitHub Issue 등록
  const issueSpinner = ora(t("pipeline.githubRegistering")).start();
  const issue = await ctx.github.createIssue(
    t("pipeline.planningIssueTitle", { title: projectTitle }),
    markdown,
    ["meeting-notes", "planning", "polymeld"]
  );
  ctx.state.github.planningIssue = issue.number;
  issueSpinner.succeed(t("pipeline.meetingRegistered", { number: issue.number, url: ctx.github.issueUrl(issue.number) }));
}

// ─── Phase 2: 태스크 분해 ─────────────────────────────

export async function phaseTaskBreakdown(ctx) {
  const spinner = ora(t("pipeline.taskBreakdownSpinner")).start();

  const designDecisions = ctx.state.designDecisions || "";
  const requirement = ctx.state.project.requirement || "";

  const availableRoles = Object.keys(ctx.config.personas || {}).join(", ");

  const result = await ctx.team.lead.breakdownTasks({
    designDecisions,
    requirement,
    availableRoles,
  });

  spinner.succeed(t("pipeline.taskBreakdownComplete"));
  printMeta(result.meta);

  let parsed = ResponseParser.parseTasks(result.tasks);
  if (!parsed.success) {
    const retrySpinner = ora(t("pipeline.taskParseRetrying")).start();
    let retryOk = false;
    try {
      const retryPrompt = t("agent.taskBreakdownRetryPrompt", {
        previousResponse: result.tasks,
      });
      const retryResponse = await ctx.team.lead.adapter.chat(
        ctx.team.lead.modelKey,
        t("agent.taskBreakdownContext"),
        retryPrompt,
        { thinkingBudget: ctx.team.lead.thinkingBudget }
      );
      parsed = ResponseParser.parseTasks(retryResponse);
      retryOk = parsed.success;
    } catch { /* retryOk stays false */ }
    if (!retryOk) {
      retrySpinner.fail();
      throw new Error(t("pipeline.taskParseFailed", { raw: (result.tasks || "").substring(0, 200) }));
    }
    retrySpinner.succeed();
  }
  let tasks = parsed.tasks;

  for (let i = 0; i < tasks.length; i++) {
    tasks[i].id = `task-${i + 1}`;
    tasks[i].suitable_role = ctx.team.normalizeRole(tasks[i].suitable_role);
    if (tasks[i].dependencies?.length) {
      tasks[i].dependencies = tasks[i].dependencies.filter(dep => {
        const n = typeof dep === 'number' ? dep : parseInt(dep, 10);
        return !isNaN(n) && n >= 1 && n <= tasks.length && n !== i + 1;
      });
    }
  }

  ctx.state.tasks = tasks;

  console.log(chalk.green(`\n${t("pipeline.tasksCreated", { count: tasks.length })}\n`));

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
> ${t("pipeline.taskBody.autoGenerated")} | ${t("pipeline.prBody.planningMeeting")}: #${ctx.state.github.planningIssue}`;

    const issue = await ctx.github.createIssue(
      `\uD83D\uDD27 ${task.title}`,
      body,
      ["backlog", "polymeld", task.category || "task"]
    );

    task.issueNumber = issue.number;
    task.nodeId = issue.node_id;

    const projectItem = await ctx.github.addIssueToProject(issue.node_id, "Backlog");
    task.projectItemId = projectItem?.id;
    taskSpinner.succeed(t("pipeline.issueCreated", { number: issue.number, title: task.title, url: ctx.github.issueUrl(issue.number) }));
  }
}

// ─── Phase 3: 작업 분배 ───────────────────────────────

export async function phaseAssignment(ctx) {
  console.log(chalk.cyan(`\n${t("pipeline.assignmentHeader")}\n`));

  for (const task of ctx.state.tasks) {
    const agent = ctx.team.assignTask(task);
    const reason = t("pipeline.assignReason", { name: agent.name, expertise: agent.expertise.slice(0, 2).join(", ") });

    const comment = t("pipeline.assignComment", { name: agent.name, role: agent.role, model: agent.modelKey, reason });

    await ctx.github.addComment(task.issueNumber, comment);
    await ctx.github.updateLabels(
      task.issueNumber,
      ["todo", `assigned:${agent.id}`],
      ["backlog"]
    );
    await ctx.github.setProjectItemStatus(task.projectItemId, "Todo");

    task.assignedAgent = agent;
    task.assignedAgentId = agent.id;

    ctx.state.addMessage({
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
