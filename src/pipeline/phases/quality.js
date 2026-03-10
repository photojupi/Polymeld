// src/pipeline/phases/quality.js
// Phase 5-6: 코드 리뷰 + QA
// LLM 호출은 병렬, 파일 I/O + Git 작업은 직렬로 실행하여 안전성과 성능을 양립

import chalk from "chalk";
import ora from "ora";
import { t } from "../../i18n/index.js";
import {
  printMeta, reviewNeedsFix, qaNeedsFix,
  takeFileSnapshot, recommitCode,
} from "../helpers.js";
import { truncateCode } from "../../state/prompt-assembler.js";
import { pMapSettled } from "../../utils/concurrency.js";

// ─── Phase 5: 코드 리뷰 (LLM 병렬 + 수정 직렬) ─────────────

export async function phaseCodeReview(ctx) {
  const lead = ctx.team.lead;

  const tasksToReview = [];
  for (const task of ctx.state.tasks) {
    if (!task.code) continue;
    if (task.reviewApproved != null) {
      console.log(chalk.gray(`  ${t("pipeline.reviewSkipped", { title: task.title })}`));
      continue;
    }
    if (task.imageOnly) {
      task.reviewApproved = true;
      task.reviewVerdict = "skipped";
      console.log(chalk.gray(`  ${t("pipeline.reviewSkipped", { title: task.title })}`));
      continue;
    }
    tasksToReview.push(task);
  }

  if (tasksToReview.length === 0) return;

  // ── Step 1: 리뷰 LLM 호출 병렬 실행 ──
  if (tasksToReview.length > 1) {
    console.log(chalk.cyan(
      `\n${t("pipeline.parallelRunning", { count: tasksToReview.length, titles: tasksToReview.map(task => task.title).join(", ") })}`
    ));
  }

  const useSpinner = tasksToReview.length === 1;

  const maxParallel = ctx.config.pipeline?.max_parallel || 3;
  const batchDelayMs = ctx.config.pipeline?.batch_delay_ms ?? 0;
  const reviewResults = await pMapSettled(tasksToReview, task => {
    console.log(chalk.cyan(`\n${t("pipeline.reviewLabel", { title: task.title })}`));
    const spinner = useSpinner
      ? ora(`  ${t("pipeline.reviewSpinner", { agent: lead.name, model: lead.modelKey })}`).start()
      : null;
    const reviewBundle = ctx.assembler.forReview(ctx.state, { taskId: task.id });
    return lead.reviewCode(reviewBundle, task.assignedAgent?.name || "unknown")
      .then(result => {
        if (spinner) spinner.succeed(`  ${t("pipeline.reviewComplete")}`);
        else console.log(chalk.green(`  [${task.title}] ${t("pipeline.reviewComplete")}`));
        printMeta(result.meta);
        return { ...result, reviewBundle };
      })
      .catch(err => {
        if (spinner) spinner.fail(`  ${t("pipeline.reviewComplete")}`);
        else console.log(chalk.red(`  [${task.title}] ${t("pipeline.reviewComplete")}`));
        throw err;
      });
  }, maxParallel, batchDelayMs);

  // ── Step 2: 결과 처리 직렬 (verdict + 수정 + recommit) ──
  for (let i = 0; i < tasksToReview.length; i++) {
    const task = tasksToReview[i];
    const settled = reviewResults[i];

    if (settled.status === "rejected") {
      console.log(chalk.red(`  ${t("pipeline.taskFailed", { title: task.title, reason: settled.reason?.message || String(settled.reason) })}`));
      task.reviewApproved = true;
      continue;
    }

    const result = settled.value;
    const { reviewBundle } = result;

    task.review = result.review;

    await ctx.github.addComment(
      task.issueNumber,
      t("pipeline.reviewComment", { agent: lead.name, attempt: 1, max: 1, model: lead.modelKey, review: result.review })
    );

    const needsFix = reviewNeedsFix(result.review);
    task.reviewVerdict = needsFix ? "changes_requested" : "approved";

    ctx.state.addMessage({
      from: "tech_lead",
      to: task.assignedAgentId,
      type: "review_feedback",
      content: result.review,
      taskId: task.id,
    });

    if (!needsFix) {
      task.reviewApproved = true;
      console.log(chalk.green(`  ${t("pipeline.reviewApproved")}`));
      continue;
    }

    // 수정 필요 → 팀장이 직접 수정 (파일 I/O 직렬)
    console.log(chalk.yellow(`  ${t("pipeline.reviewChangesRequested", { attempt: 1, max: 1 })}`));

    const fixSpinner = ora(
      `  ${t("pipeline.leadFixSpinner", { agent: lead.name, model: lead.modelKey })}`
    ).start();

    try {
      let currentCode = task.code;
      if (ctx.workspace?.isLocal && task.filePaths?.length) {
        const diskContent = ctx.workspace.readFile(task.filePaths[0]);
        if (diskContent) currentCode = diskContent;
      }
      currentCode = truncateCode(currentCode);
      const leadFixBundle = {
        systemContext: `${reviewBundle.systemContext}\n\n${t("promptAssembler.reviewFeedback")}\n${result.review}`,
        taskDescription: task.description || "",
        acceptanceCriteria: task.acceptance_criteria?.join("\n") || "",
        currentCode,
      };
      const preSnapshot = takeFileSnapshot(ctx.workspace);
      const fixResult = await lead.writeCode(leadFixBundle);
      fixSpinner.succeed(`  ${t("pipeline.leadFixComplete", { agent: lead.name })}`);
      printMeta(fixResult?.meta);

      if (fixResult) {
        task.code = fixResult.code;
        await recommitCode(
          ctx, task, fixResult.code,
          `fix: lead direct fix for ${task.title} (#${task.issueNumber})`,
          preSnapshot
        );
        await ctx.github.addComment(
          task.issueNumber,
          t("pipeline.leadFixComment", { agent: lead.name, model: lead.modelKey })
        );
      }
    } catch (e) {
      fixSpinner.fail(`  ${t("pipeline.leadFixComplete", { agent: lead.name })}`);
      console.log(chalk.yellow(`    ${e.message}`));
    }

    task.reviewApproved = true;
    console.log(chalk.green(`  ${t("pipeline.reviewApproved")}`));
  }
}

// ─── Phase 6: QA (attempt별 배치 병렬 + 수정 직렬) ────────────────

export async function phaseQA(ctx) {
  const qaAgent = ctx.team.qa;
  const lead = ctx.team.lead;
  const maxRetries = ctx.config.pipeline?.max_qa_retries || 3;
  const maxParallel = ctx.config.pipeline?.max_parallel || 3;
  const batchDelayMs = ctx.config.pipeline?.batch_delay_ms ?? 0;
  const fallbackKey = ctx.config.models?.[qaAgent.modelKey]?.fallback;

  // ── Pre-filter ──
  const pendingTasks = [];
  for (const task of ctx.state.tasks) {
    if (!task.code) continue;

    if (task.qaPassed != null) {
      console.log(chalk.gray(`  ${t("pipeline.qaSkipped", { title: task.title })}`));
      continue;
    }

    if (task.imageOnly) {
      task.qaPassed = true;
      task.qaAttempts = 0;
      task.qaVerdict = "skipped";
      console.log(chalk.gray(`  ${t("pipeline.qaSkipped", { title: task.title })}`));
      await ctx.github.updateLabels(task.issueNumber, ["done"], ["in-review"]);
      await ctx.github.closeIssue(task.issueNumber);
      await ctx.github.setProjectItemStatus(task.projectItemId, "Done");
      ctx.state.completedTasks.push(task);
      continue;
    }

    const hasFilePaths = task.filePaths && task.filePaths.length > 0;
    if (!hasFilePaths) {
      console.log(chalk.yellow(`  ${t("pipeline.qaSkippedNoFiles", { title: task.title })}`));
      task.qaPassed = true;
      task.qaAttempts = 0;
      task.qaVerdict = "skipped";
      await ctx.github.updateLabels(task.issueNumber, ["done"], ["in-review"]);
      await ctx.github.closeIssue(task.issueNumber);
      ctx.state.completedTasks.push(task);
      continue;
    }

    await ctx.github.updateLabels(task.issueNumber, ["qa"], ["in-review"]);
    await ctx.github.setProjectItemStatus(task.projectItemId, "QA");

    ctx.state.addMessage({
      from: "orchestrator",
      to: "qa",
      type: "qa_request",
      content: t("pipeline.qaRequestMessage", { title: task.title }),
      taskId: task.id,
    });

    pendingTasks.push(task);
  }

  if (pendingTasks.length === 0) return;

  // ── Attempt-batched parallel QA ──
  let activeTasks = pendingTasks.slice();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (activeTasks.length === 0) break;

    const useModelOverride = (attempt >= 2 && fallbackKey) ? fallbackKey : null;
    const currentModel = useModelOverride || qaAgent.modelKey;

    // Fallback 모델 전환 안내 (1회)
    if (attempt === 2 && useModelOverride) {
      console.log(chalk.yellow(`  ${t("pipeline.qaFallbackSwitch", { from: qaAgent.modelKey, to: useModelOverride })}`));
    }

    // 태스크별 attempt 라벨
    for (const task of activeTasks) {
      if (attempt === 1) {
        console.log(chalk.cyan(`\n${t("pipeline.qaLabel", { title: task.title })}`));
      } else {
        console.log(chalk.cyan(`\n${t("pipeline.qaRetryLabel", { attempt, max: maxRetries, title: task.title })}`));
      }
    }

    if (activeTasks.length > 1) {
      console.log(chalk.cyan(
        `\n${t("pipeline.parallelRunning", { count: activeTasks.length, titles: activeTasks.map(task => task.title).join(", ") })}`
      ));
    }

    // Step 1: QA LLM 호출 병렬 실행
    const useSpinner = activeTasks.length === 1;

    const qaResults = await pMapSettled(activeTasks, task => {
      const qaBundle = ctx.assembler.forQA(ctx.state, { taskId: task.id });
      const spinner = useSpinner
        ? ora(`  ${t("pipeline.qaSpinner", { agent: qaAgent.name, model: currentModel })}`).start()
        : null;
      return qaAgent.runQA(qaBundle, { modelOverride: useModelOverride })
        .then(result => {
          if (spinner) spinner.succeed(`  ${t("pipeline.qaComplete")}`);
          else console.log(chalk.green(`  [${task.title}] ${t("pipeline.qaComplete")}`));
          printMeta(result.meta);
          return result;
        })
        .catch(err => {
          if (spinner) spinner.fail(`  ${t("pipeline.qaComplete")}`);
          else console.log(chalk.red(`  [${task.title}] ${t("pipeline.qaComplete")}`));
          throw err;
        });
    }, maxParallel, batchDelayMs);

    // Step 2: 결과 처리 직렬 (verdict + 수정 + recommit)
    const stillFailed = [];

    for (let i = 0; i < activeTasks.length; i++) {
      const task = activeTasks[i];
      const settled = qaResults[i];

      let qaResult = null;
      let qaTimedOut = false;
      let qaErrorMsg = null;

      if (settled.status === "rejected") {
        qaTimedOut = true;
        qaErrorMsg = settled.reason?.message || String(settled.reason);
        console.log(chalk.red(`    ${qaErrorMsg}`));
      } else {
        qaResult = settled.value.qaResult;
      }

      if (qaResult) {
        task.qa = qaResult;
        await ctx.github.addComment(
          task.issueNumber,
          t("pipeline.qaComment", { agent: qaAgent.name, attempt, max: maxRetries, model: currentModel, result: qaResult })
        );
      }

      const hasFail = qaTimedOut || (qaResult != null && qaNeedsFix(qaResult));
      task.qaVerdict = hasFail ? "fail" : "pass";

      ctx.state.addMessage({
        from: "qa",
        to: task.assignedAgentId,
        type: "qa_result",
        content: qaResult || qaErrorMsg || "QA error",
        taskId: task.id,
      });

      if (!hasFail) {
        task.qaPassed = true;
        task.qaAttempts = attempt;
        console.log(chalk.green(`  ${t("pipeline.qaPassed")}`));

        await ctx.github.updateLabels(task.issueNumber, ["done"], ["qa"]);
        await ctx.github.closeIssue(task.issueNumber);
        await ctx.github.setProjectItemStatus(task.projectItemId, "Done");
        ctx.state.completedTasks.push(task);
        continue;
      }

      console.log(chalk.yellow(`  ${t("pipeline.qaFailed", { attempt, max: maxRetries })}`));

      if (attempt >= maxRetries) {
        stillFailed.push(task);
        continue;
      }

      // 수정 직렬 (파일 I/O + Git)
      if (!qaTimedOut) {
        const fixSpinner = ora(
          `  ${t("pipeline.leadFixSpinner", { agent: lead.name, model: lead.modelKey })}`
        ).start();

        try {
          let currentCode = task.code;
          if (ctx.workspace?.isLocal && task.filePaths?.length) {
            const diskContent = ctx.workspace.readFile(task.filePaths[0]);
            if (diskContent) currentCode = diskContent;
          }
          currentCode = truncateCode(currentCode);
          const qaBundle = ctx.assembler.forQA(ctx.state, { taskId: task.id });
          const leadFixBundle = {
            systemContext: `${qaBundle.systemContext}\n\n${t("promptAssembler.qaFeedback")}\n${qaResult}`,
            taskDescription: task.description || "",
            acceptanceCriteria: task.acceptance_criteria?.join("\n") || "",
            currentCode,
          };
          const preSnapshot = takeFileSnapshot(ctx.workspace);
          const fixResult = await lead.writeCode(leadFixBundle);
          fixSpinner.succeed(`  ${t("pipeline.leadFixComplete", { agent: lead.name })}`);
          printMeta(fixResult?.meta);

          if (fixResult) {
            task.code = fixResult.code;
            await recommitCode(
              ctx, task, fixResult.code,
              `fix: lead direct fix for QA feedback on ${task.title} (#${task.issueNumber})`,
              preSnapshot
            );
            await ctx.github.addComment(
              task.issueNumber,
              t("pipeline.qaFixComment", { agent: lead.name, model: lead.modelKey, attempt })
            );
          }
        } catch (e) {
          fixSpinner.fail(`  ${t("pipeline.leadFixComplete", { agent: lead.name })}`);
          console.log(chalk.yellow(`    ${e.message}`));
        }
      }

      stillFailed.push(task);
    }

    activeTasks = stillFailed;
  }

  // ── Step 3: 모든 시도 소진 태스크 — 사용자 확인 (순차) ──
  for (const task of activeTasks) {
    console.log(chalk.yellow(`  ${t("pipeline.qaMaxRetries", { max: maxRetries })}`));

    const { action } = await ctx.interaction.confirmWarning(
      t("pipeline.qaMaxRetriesConfirm", { title: task.title, max: maxRetries }),
      "warning"
    );

    if (action === "abort") {
      throw new Error("Pipeline aborted by user");
    } else if (action === "skip") {
      await ctx.github.addComment(
        task.issueNumber,
        t("pipeline.qaSkipComment", { max: maxRetries })
      );
      await ctx.github.updateLabels(task.issueNumber, [], ["qa"]);
      task.qaPassed = false;
      task.qaAttempts = maxRetries;
      continue;
    } else {
      await ctx.github.addComment(
        task.issueNumber,
        t("pipeline.qaProceedComment", { max: maxRetries })
      );
      task.qaPassed = true;
      task.qaAttempts = maxRetries;
    }

    // Done 처리
    await ctx.github.updateLabels(task.issueNumber, ["done"], ["qa"]);
    await ctx.github.closeIssue(task.issueNumber);
    await ctx.github.setProjectItemStatus(task.projectItemId, "Done");
    ctx.state.completedTasks.push(task);
  }
}
