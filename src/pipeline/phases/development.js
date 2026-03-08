// src/pipeline/phases/development.js
// Phase 4: 개발 (병렬/순차 실행 + 개별 태스크 개발)

import fs from "fs";
import path from "path";
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

  // ── 이미지 전용 에이전트(illustrator): writeCode 건너뛰고 바로 이미지 생성 ──
  // designer 등 겸용 에이전트는 기존 흐름 (writeCode → 이미지 생성)
  if (agent.imageOnly && agent.canGenerateImages && isImageTask(task)) {
    await handleImageOnlyTask(ctx, task, agent, { branchName, baseBranch });
    return;
  }

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

/**
 * 이미지 전용 태스크 처리 — writeCode를 건너뛰고 바로 이미지 생성
 * 멀티 에셋 태스크는 개별 프롬프트로 분해 후 각각 생성
 */
async function handleImageOnlyTask(ctx, task, agent, { branchName, baseBranch }) {
  const imageSpinner = ora(`  🎨 ${t("pipeline.imageSpinner", { agent: agent.name })}`).start();

  // 태스크를 개별 이미지 프롬프트로 분해
  const prompts = await decomposeImageTask(agent, task);
  imageSpinner.text = `  🎨 ${agent.name}: ${prompts.length} images`;

  const allImages = [];
  let allText = "";
  const metas = [];

  for (let i = 0; i < prompts.length; i++) {
    const { prompt: imagePrompt, outputPath } = prompts[i];
    imageSpinner.text = `  🎨 ${agent.name} (${i + 1}/${prompts.length})`;
    try {
      const imageBundle = ctx.assembler.forImageGeneration(ctx.state, {
        imagePrompt,
        taskId: task.id,
        outputDir: `./output/images/${task.id}`,
      });
      const imageResult = await agent.generateImage(imageBundle);

      // outputPath가 지정되어 있으면 해당 경로로 이동
      for (let j = 0; j < imageResult.images.length; j++) {
        const img = imageResult.images[j];
        if (!outputPath || img.path === outputPath) continue;
        // 다수 이미지 반환 시 suffix 추가로 덮어쓰기 방지
        const dest = imageResult.images.length === 1
          ? outputPath
          : outputPath.replace(/(\.\w+)$/, `_${j + 1}$1`);
        try {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.renameSync(img.path, dest);
          img.path = dest;
        } catch {
          try {
            fs.copyFileSync(img.path, dest);
            fs.unlinkSync(img.path);
            img.path = dest;
          } catch (e) {
            console.log(chalk.yellow(`  ⚠ rename failed, keeping original: ${e.message}`));
          }
        }
      }

      allImages.push(...imageResult.images);
      if (imageResult.textResponse) allText += imageResult.textResponse + "\n";
      if (imageResult.meta) metas.push(imageResult.meta);
    } catch (e) {
      imageSpinner.clear();
      console.log(chalk.yellow(`  ⚠ (${i + 1}/${prompts.length}) ${e.message}`));
      imageSpinner.render();
    }
  }

  if (allImages.length > 0) {
    imageSpinner.succeed(
      `  ${t("pipeline.imageComplete", { agent: agent.name, count: allImages.length })}`
    );
    for (const meta of metas) printMeta(meta);

    task.images = { images: allImages, text: allText };
    task.code = allText || `[Image: ${allImages.length} files generated]`;
    task.filePaths = allImages.map(img => img.path);
    task.filePath = task.filePaths[0];

    // Git 커밋
    if (ctx.workspace?.isLocal) {
      await enqueueGit(ctx, () => {
        try {
          ctx.workspace.gitCheckoutNewBranch(branchName, baseBranch);
          ctx.workspace.gitAdd(task.filePaths);
          ctx.workspace.invalidateCache();
          ctx.workspace.gitCommit(
            `art: ${task.title} (#${task.issueNumber})\n\nGenerated by: ${agent.name} (${agent.imageModelKey})`
          );
          const pathLog = task.filePaths.join(", ");
          console.log(chalk.gray(`  ${t("pipeline.localCommit", { path: pathLog })}`));
        } catch (e) {
          console.log(chalk.yellow(`  ${t("pipeline.localCommitFailed", { message: e.message })}`));
        }
      });
    } else {
      // 원격 환경: GitHub API로 이미지 파일 커밋
      await enqueueGit(ctx, async () => {
        try {
          if (ctx.config.pipeline?.auto_branch) {
            await ctx.github.createBranch(branchName);
          }
          for (const img of allImages) {
            const content = fs.readFileSync(img.path, { encoding: "base64" });
            await ctx.github.commitFile(branchName, img.path, content,
              `art: ${task.title} (#${task.issueNumber})\n\nGenerated by: ${agent.name} (${agent.imageModelKey})`
            );
          }
          console.log(chalk.gray(`  ${t("pipeline.commit", { path: task.filePaths.join(", ") })}`));
        } catch (e) {
          console.log(chalk.yellow(`  ${t("pipeline.commitSkipped", { message: e.message })}`));
        }
      });
    }

    const imageList = allImages.map(img => `- \`${img.path}\``).join("\n");
    await ctx.github.addComment(
      task.issueNumber,
      t("pipeline.imageComment", { agent: agent.name, model: agent.imageModelKey, imageList, text: allText })
    );
  } else {
    imageSpinner.warn(`  ${t("pipeline.imageFailed", { message: "No images returned" })}`);
    task.code = `[Image generation failed: No images returned]`;
  }

  // 완료 처리 (성공/실패 모두)
  await ctx.github.addComment(
    task.issueNumber,
    t("pipeline.devCompleteComment", { agent: agent.name, model: agent.imageModelKey || agent.modelKey })
  );
  await ctx.github.updateLabels(task.issueNumber, ["in-review"], ["in-progress"]);
  await ctx.github.setProjectItemStatus(task.projectItemId, "In Review");
}

/**
 * 이미지 태스크를 개별 프롬프트로 분해
 * 텍스트 모델로 태스크를 분석 → 에셋별 개별 프롬프트 배열 반환
 */
async function decomposeImageTask(agent, task) {
  const description = task.description || task.title;
  const criteria = task.acceptance_criteria?.map(c => `- ${c}`).join("\n") || "";

  const systemPrompt = agent._buildSystemPrompt(
    "You decompose image generation tasks into individual prompts."
  );

  const prompt = [
    "다음 이미지 생성 태스크를 개별 이미지 프롬프트로 분해하세요.",
    "각 프롬프트 = AI 이미지 생성기에 1회 요청 = 개별 파일 1개.",
    "각 에셋이 별도 파일로 사용 가능하도록 분리하세요.",
    "",
    `태스크: ${task.title}`,
    `설명: ${description}`,
    criteria ? `수용 기준:\n${criteria}` : "",
    "",
    "JSON 배열만 출력 (다른 텍스트 없이):",
    "수용 기준에 파일 경로가 명시되어 있으면 outputPath에 해당 경로를 사용하세요.",
    "파일 경로를 알 수 없으면 outputPath를 null로 설정하세요.",
    '[{"prompt": "이미지 생성 프롬프트", "outputPath": "assets/path/file.png"}, ...]',
  ].filter(Boolean).join("\n");

  try {
    const result = await agent.adapter.chat(agent.modelKey, systemPrompt, prompt, {
      thinkingBudget: 0,
    });
    const text = String(result);
    const startIdx = text.indexOf("[");
    const lastIdx = text.lastIndexOf("]");
    if (startIdx !== -1 && lastIdx > startIdx) {
      const parsed = JSON.parse(text.slice(startIdx, lastIdx + 1));
      if (Array.isArray(parsed) && parsed.length > 0) {
        const sanitizePath = (p) => {
          if (!p || typeof p !== "string") return null;
          if (path.isAbsolute(p) || p.includes("..")) return null;
          return p;
        };
        return parsed.map(item =>
          typeof item === "string"
            ? { prompt: item, outputPath: null }
            : { prompt: item.prompt || String(item), outputPath: sanitizePath(item.outputPath) }
        );
      }
    }
  } catch { /* fallback */ }

  return [{ prompt: description, outputPath: null }];
}
