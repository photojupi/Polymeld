// src/pipeline/phases/development.js
// Phase 4: 개발 (병렬/순차 실행 + 개별 태스크 개발)

import chalk from "chalk";
import ora from "ora";
import { t } from "../../i18n/index.js";
import {
  isImageTask, printMeta, parseFilePathsFromResponse, getReadyTasks,
  enqueueGit,
} from "../helpers.js";

// ─── Phase 4: 개발 ───────────────────────────────────

export async function phaseDevelopment(ctx) {
  const parallelEnabled = ctx.config.pipeline?.parallel_development !== false;

  // 워크스페이스 트리 캐싱 (Phase 진입 시 1회)
  const treeCache = ctx.workspace?.isLocal ? ctx.workspace.getTree() : null;
  const baseBranch = ctx.workspace?.isLocal ? ctx.workspace.getCurrentBranch() : null;

  // 통합 브랜치
  const projectTitle = ctx.state.project.title || "project";
  const slug = projectTitle.replace(/[^a-zA-Z0-9가-힣]/g, "-").substring(0, 30);
  const issueNum = ctx.state.github.planningIssue || "0";
  const integrationBranch = `feature/${issueNum}-${slug}`;

  if (!parallelEnabled) {
    for (const task of ctx.state.tasks) {
      if (!task.assignedAgent || task.code) {
        if (task.code) console.log(chalk.gray(`  ${t("pipeline.devSkipped", { title: task.title })}`));
        continue;
      }
      await developTask(ctx, task, { treeCache, baseBranch, integrationBranch });
    }
    return;
  }

  // ── 의존성 기반 병렬 실행 ──
  const completedIds = new Set();
  const failedIds = new Set();

  for (const task of ctx.state.tasks) {
    if (task.code) {
      console.log(chalk.gray(`  ${t("pipeline.devSkipped", { title: task.title })}`));
      completedIds.add(task.id);
    }
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const readyTasks = getReadyTasks(ctx.state.tasks, completedIds, failedIds);

    if (readyTasks.length === 0) {
      const remaining = ctx.state.tasks.filter(task =>
        !completedIds.has(task.id) && !failedIds.has(task.id) && task.assignedAgent && !task.code
      );
      if (remaining.length === 0) break;
      console.log(chalk.yellow(`\n  ${t("pipeline.parallelWaiting", { count: remaining.length })}`));
      for (const task of remaining) {
        await developTask(ctx, task, { treeCache, baseBranch, integrationBranch });
        completedIds.add(task.id);
      }
      break;
    }

    if (readyTasks.length > 1) {
      console.log(chalk.cyan(
        `\n${t("pipeline.parallelRunning", { count: readyTasks.length, titles: readyTasks.map(task => task.title).join(", ") })}`
      ));
    }

    const results = await Promise.allSettled(
      readyTasks.map(task => developTask(ctx, task, { treeCache, baseBranch, integrationBranch }))
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

/**
 * 개별 태스크 개발 (LLM 호출 + Git 작업)
 */
async function developTask(ctx, task, { treeCache, baseBranch, integrationBranch }) {
  const agent = task.assignedAgent;
  if (!agent) return;

  console.log(
    chalk.cyan(`\n${t("pipeline.devStart", { agent: agent.name, model: agent.modelKey, title: task.title })}`)
  );

  // GitHub 상태 업데이트
  await ctx.github.updateLabels(task.issueNumber, ["in-progress"], ["todo"]);
  await ctx.github.setProjectItemStatus(task.projectItemId, "In Progress");
  await ctx.github.addComment(
    task.issueNumber,
    t("pipeline.devStartComment", { agent: agent.name, model: agent.modelKey })
  );

  const branchName = integrationBranch;
  task.branchName = branchName;

  // 코드베이스 맥락 조립
  let codebaseContext = null;
  if (ctx.workspace?.isLocal) {
    const relevantFiles = ctx.workspace.findRelevantFiles(
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

  // 에이전트 호출 전 파일 상태 스냅샷
  const preUntracked = new Set(
    ctx.workspace?.isLocal ? ctx.workspace.getUntrackedFiles() : []
  );
  const preModified = new Set(
    ctx.workspace?.isLocal ? ctx.workspace.getModifiedFiles() : []
  );

  // LLM 호출
  const spinner = ora(`  ${t("pipeline.codingSpinner", { agent: agent.name })}`).start();
  const contextBundle = ctx.assembler.forCoding(ctx.state, { agentId: agent.id, taskId: task.id, codebaseContext });
  const result = await agent.writeCode(contextBundle);
  spinner.succeed(`  ${t("pipeline.codingComplete", { agent: agent.name })}`);
  printMeta(result.meta);

  task.code = result.code;

  // 에이전트가 직접 생성/수정한 파일 감지
  const EXCLUDE_PATTERNS = [".DS_Store", ".polymeld/"];
  const isExcluded = (f) => EXCLUDE_PATTERNS.some((p) => f.includes(p));

  let detectedFiles = [];
  if (ctx.workspace?.isLocal) {
    const postUntracked = ctx.workspace.getUntrackedFiles();
    const postModified = ctx.workspace.getModifiedFiles();
    const newFiles = postUntracked.filter((f) => !preUntracked.has(f) && !isExcluded(f));
    const changedFiles = postModified.filter((f) => !preModified.has(f) && !isExcluded(f));
    detectedFiles = [...new Set([...newFiles, ...changedFiles])];
  }

  // 파일 경로 결정
  if (detectedFiles.length > 0) {
    task.filePaths = detectedFiles;
    task.filePath = detectedFiles[0];
  } else {
    const parsed = parseFilePathsFromResponse(result.code);
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
  if (ctx.workspace?.isLocal) {
    await enqueueGit(ctx, () => {
      try {
        ctx.workspace.gitCheckoutNewBranch(branchName, baseBranch);

        if (detectedFiles.length > 0) {
          ctx.workspace.gitAdd(detectedFiles);
        } else {
          const codeMatch = result.code.match(/```[\w]*\n([\s\S]*?)```/);
          const cleanCode = codeMatch ? codeMatch[1] : result.code;
          ctx.workspace.writeFile(task.filePath, cleanCode);
          ctx.workspace.gitAdd([task.filePath]);
        }

        ctx.workspace.invalidateCache();
        ctx.workspace.gitCommit(
          `feat: ${task.title} (#${task.issueNumber})\n\nDeveloped by: ${agent.name} (${agent.modelKey})`
        );
        const pathLog = task.filePaths.join(", ");
        console.log(chalk.gray(`  ${t("pipeline.localCommit", { path: pathLog })}`));
      } catch (e) {
        console.log(chalk.yellow(`  ${t("pipeline.localCommitFailed", { message: e.message })}`));
      }
    });
  } else {
    await enqueueGit(ctx, async () => {
      try {
        if (ctx.config.pipeline?.auto_branch) {
          await ctx.github.createBranch(branchName);
        }
        const codeMatch = result.code.match(/```[\w]*\n([\s\S]*?)```/);
        const cleanCode = codeMatch ? codeMatch[1] : result.code;
        await ctx.github.commitFile(
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

  ctx.state.addMessage({
    from: agent.id,
    to: "tech_lead",
    type: "review_request",
    content: t("pipeline.devCompleteMessage", { title: task.title }),
    taskId: task.id,
  });

  // 이미지 생성
  if (agent.canGenerateImages && isImageTask(task)) {
    const imageSpinner = ora(`  ${t("pipeline.imageSpinner", { agent: agent.name })}`).start();
    try {
      const imageBundle = ctx.assembler.forImageGeneration(ctx.state, {
        imagePrompt: task.description || task.title,
        taskId: task.id,
        outputDir: `./output/images/${task.id}`,
      });
      const imageResult = await agent.generateImage(imageBundle);
      imageSpinner.succeed(
        `  ${t("pipeline.imageComplete", { agent: agent.name, count: imageResult.images.length })}`
      );
      printMeta(imageResult.meta);

      task.images = {
        images: imageResult.images,
        text: imageResult.textResponse,
      };

      if (imageResult.images.length > 0) {
        const imageList = imageResult.images.map(img => `- \`${img.path}\``).join("\n");
        await ctx.github.addComment(
          task.issueNumber,
          t("pipeline.imageComment", { agent: agent.name, model: agent.imageModelKey, imageList, text: imageResult.textResponse || "" })
        );
      }
    } catch (e) {
      imageSpinner.fail(`  ${t("pipeline.imageFailed", { message: e.message })}`);
    }
  }

  // 완료 코멘트
  await ctx.github.addComment(
    task.issueNumber,
    `${t("pipeline.devCompleteComment", { agent: agent.name, model: agent.modelKey })}\n\n<details>\n<summary>${t("pipeline.codePreviewSummary")}</summary>\n\n${result.code.substring(0, 1000)}${result.code.length > 1000 ? "\n...(truncated)" : ""}\n</details>`
  );

  await ctx.github.updateLabels(task.issueNumber, ["in-review"], ["in-progress"]);
  await ctx.github.setProjectItemStatus(task.projectItemId, "In Review");
}
