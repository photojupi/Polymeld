// src/pipeline/phases/quality.js
// Phase 5-6: 코드 리뷰 + QA

import chalk from "chalk";
import ora from "ora";
import { t } from "../../i18n/index.js";
import {
  printMeta, reviewNeedsFix, qaNeedsFix,
  takeFileSnapshot, recommitCode,
} from "../helpers.js";

// ─── Phase 5: 코드 리뷰 (실패 시 팀장 직접 수정) ─────────────

export async function phaseCodeReview(ctx) {
  const lead = ctx.team.lead;

  for (const task of ctx.state.tasks) {
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
    const reviewBundle = ctx.assembler.forReview(ctx.state, { taskId: task.id });
    const result = await lead.reviewCode(reviewBundle, task.assignedAgent?.name || "unknown");
    spinner.succeed(`  ${t("pipeline.reviewComplete")}`);
    printMeta(result.meta);

    task.review = result.review;

    await ctx.github.addComment(
      task.issueNumber,
      t("pipeline.reviewComment", { agent: lead.name, attempt: 1, max: 1, model: lead.modelKey, review: result.review })
    );

    // 2) 결과 판정
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

    // 3) 수정 필요 → 팀장이 직접 수정
    console.log(chalk.yellow(`  ${t("pipeline.reviewChangesRequested", { attempt: 1, max: 1 })}`));

    const fixSpinner = ora(
      `  ${t("pipeline.leadFixSpinner", { agent: lead.name, model: lead.modelKey })}`
    ).start();

    // P2: 디스크의 실제 파일 내용 사용 (task.code보다 정확)
    let currentCode = task.code;
    if (ctx.workspace?.isLocal && task.filePaths?.length) {
      const diskContent = ctx.workspace.readFile(task.filePaths[0]);
      if (diskContent) currentCode = diskContent;
    }
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

    task.reviewApproved = true;
    console.log(chalk.green(`  ${t("pipeline.reviewApproved")}`));
  }
}

// ─── Phase 6: QA (재시도 + fallback 모델 전환) ────────────────

export async function phaseQA(ctx) {
  const qaAgent = ctx.team.qa;
  const lead = ctx.team.lead;
  const maxRetries = ctx.config.pipeline?.max_qa_retries || 3;
  const fallbackKey = ctx.config.models?.[qaAgent.modelKey]?.fallback;

  for (const task of ctx.state.tasks) {
    if (!task.code) continue;

    // 재개 시 이미 QA 완료된 태스크 스킵
    if (task.qaPassed != null) {
      console.log(chalk.gray(`  ${t("pipeline.qaSkipped", { title: task.title })}`));
      continue;
    }

    // 실행 기반 QA 불가 시 스킵
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

    await ctx.github.updateLabels(
      task.issueNumber,
      ["qa"],
      ["in-review"]
    );
    await ctx.github.setProjectItemStatus(task.projectItemId, "QA");

    ctx.state.addMessage({
      from: "orchestrator",
      to: "qa",
      type: "qa_request",
      content: t("pipeline.qaRequestMessage", { title: task.title }),
      taskId: task.id,
    });

    let passed = false;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const useModelOverride = (attempt >= 2 && fallbackKey) ? fallbackKey : null;
      const currentModel = useModelOverride || qaAgent.modelKey;

      if (attempt === 1) {
        console.log(chalk.cyan(`\n${t("pipeline.qaLabel", { title: task.title })}`));
      } else {
        console.log(chalk.cyan(`\n${t("pipeline.qaRetryLabel", { attempt, max: maxRetries, title: task.title })}`));
        if (attempt === 2 && useModelOverride) {
          console.log(chalk.yellow(`  ${t("pipeline.qaFallbackSwitch", { from: qaAgent.modelKey, to: useModelOverride })}`));
        }
      }

      let qaResult = null;
      let qaTimedOut = false;
      let qaErrorMsg = null;
      const qaBundle = ctx.assembler.forQA(ctx.state, { taskId: task.id });

      const spinner = ora(
        `  ${t("pipeline.qaSpinner", { agent: qaAgent.name, model: currentModel })}`
      ).start();

      try {
        const result = await qaAgent.runQA(qaBundle, { modelOverride: useModelOverride });
        spinner.succeed(`  ${t("pipeline.qaComplete")}`);
        printMeta(result.meta);
        qaResult = result.qaResult;
      } catch (error) {
        spinner.fail(`  ${t("pipeline.qaComplete")}`);
        console.log(chalk.red(`    ${error.message}`));
        qaTimedOut = true;
        qaErrorMsg = error.message;
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
        passed = true;
        break;
      }

      console.log(chalk.yellow(`  ${t("pipeline.qaFailed", { attempt, max: maxRetries })}`));

      if (attempt >= maxRetries) break;

      // 코드 수정
      if (!qaTimedOut) {
        const fixSpinner = ora(
          `  ${t("pipeline.leadFixSpinner", { agent: lead.name, model: lead.modelKey })}`
        ).start();

        // P2: 디스크의 실제 파일 내용 사용
        let currentCode = task.code;
        if (ctx.workspace?.isLocal && task.filePaths?.length) {
          const diskContent = ctx.workspace.readFile(task.filePaths[0]);
          if (diskContent) currentCode = diskContent;
        }
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
      }
    }

    // 모든 시도 소진 시 사용자 확인
    if (!passed) {
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
    }

    // Done 처리
    await ctx.github.updateLabels(task.issueNumber, ["done"], ["qa"]);
    await ctx.github.closeIssue(task.issueNumber);
    await ctx.github.setProjectItemStatus(task.projectItemId, "Done");
    ctx.state.completedTasks.push(task);
  }
}
