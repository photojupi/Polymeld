// src/pipeline/helpers.js
// 파이프라인 오케스트레이터 유틸리티 함수 모음

import chalk from "chalk";
import { ResponseParser } from "../models/response-parser.js";
import { t } from "../i18n/index.js";

// ─── 순수 함수 (this/ctx 불필요) ──────────────────────

/**
 * 태스크가 이미지 생성 관련인지 판단
 */
export function isImageTask(task) {
  if (task.category === "art") return true;
  const keywords = ["이미지", "image", "디자인", "design", "목업", "mockup",
    "아이콘", "icon", "일러스트", "illustrat", "배너", "banner",
    "로고", "logo", "와이어프레임", "wireframe",
    "시안", "컨셉", "concept", "에셋", "asset",
    "스프라이트", "sprite", "텍스처", "texture", "렌더링", "render"];
  const text = `${task.title || ""} ${task.description || ""}`.toLowerCase();
  if (keywords.some(kw => text.includes(kw.toLowerCase()))) return true;
  // "UI"는 단어 경계 매칭 (build, fluid 등 오탐 방지)
  return /\bui\b/i.test(`${task.title || ""} ${task.description || ""}`);
}

export function formatMetaLine(meta) {
  if (!meta) return null;
  const colorFn = (m) =>
    m.includes("claude") ? chalk.hex("#D4A574")
      : m.includes("gemini") ? chalk.hex("#4285F4")
        : chalk.hex("#10A37F");
  const label = meta.backend === "api" ? "API" : "CLI";
  const model = meta.model || "-";
  let tokenStr = "-";
  if (meta.usage) {
    const inp = meta.usage.inputTokens?.toLocaleString() || "0";
    const out = meta.usage.outputTokens?.toLocaleString() || "0";
    tokenStr = `${inp} → ${out} ${t("pipeline.metaTokens")}`;
  }
  return chalk.dim("  ╰ ") + chalk.dim(`${label} · `) + colorFn(model)(model) + chalk.dim(` · ${tokenStr}`);
}

export function printMeta(meta) {
  const line = formatMetaLine(meta);
  if (line) console.log(line);
}

/**
 * 리뷰 결과에서 수정이 필요한지 판단
 */
export function reviewNeedsFix(review) {
  return ResponseParser.parseReviewVerdict(review).verdict === "CHANGES_REQUESTED";
}

export function qaNeedsFix(qaResult) {
  return ResponseParser.parseQAVerdict(qaResult).verdict === "FAIL";
}

/**
 * 의존성이 모두 충족된 실행 가능 태스크 목록 반환
 */
export function getReadyTasks(tasks, completedIds, failedIds) {
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
 * LLM 응답 텍스트에서 파일 경로를 추출
 */
export function parseFilePathsFromResponse(responseText) {
  if (!responseText) return [];
  const paths = new Set();
  const FILE_EXT = /\.(js|ts|jsx|tsx|mjs|cjs|py|go|rs|java|rb|sh|bash|zsh|md|json|yaml|yml|toml|css|scss|html|vue|svelte|c|cpp|h|hpp|cs|swift|kt|gd|gdshader|tscn|tres)$/i;

  const addIfValid = (p) => {
    if (!p || p.startsWith("/") || p.endsWith("/")) return;
    // 인식 가능한 파일 확장자가 있는 경로만 허용
    if (!FILE_EXT.test(p)) return;
    paths.add(p);
  };

  // 패턴 1: ```lang filepath (예: ```javascript src/utils/helper.js)
  for (const m of responseText.matchAll(/```\w*\s+([\w./-]+)/g)) {
    addIfValid(m[1]);
  }
  // 패턴 2: 코드블록 내 첫 줄 주석 (// path/file.ext 또는 # path/file.ext)
  for (const m of responseText.matchAll(/```\w*\n\s*(?:\/\/|#)\s*([\w./-]+)/g)) {
    addIfValid(m[1]);
  }
  return [...paths];
}

// ─── ctx 의존 헬퍼 ──────────────────────────────────

export function printModelAssignment(ctx) {
  const modelColorFn = (key) =>
    key === "claude" ? chalk.hex("#D4A574")
      : key === "gemini" ? chalk.hex("#4285F4")
        : chalk.hex("#10A37F");

  console.log(chalk.bold(t("pipeline.modelAssignment")));
  console.log(chalk.gray("\u2500".repeat(50)));

  for (const agent of ctx.team.getActiveAgents()) {
    const imageTag = agent.imageModelKey
      ? chalk.gray(` + image:${agent.imageModelKey}`)
      : "";
    console.log(
      `  ${agent.name} (${agent.role}): ${modelColorFn(agent.modelKey)(agent.modelKey)}${imageTag}`
    );
  }

  console.log(chalk.gray("\u2500".repeat(50)) + "\n");
}

/**
 * 재개 시 태스크의 assignedAgentId → assignedAgent 참조 복원
 */
export function relinkAgents(ctx) {
  for (const task of ctx.state.tasks) {
    if (task.assignedAgentId && typeof task.assignedAgent?.writeCode !== "function") {
      task.assignedAgent = ctx.team.getAgent(task.assignedAgentId);
      if (!task.assignedAgent) {
        console.log(chalk.yellow(
          `  ${t("pipeline.agentNotFound", { id: task.assignedAgentId, title: task.title })}`
        ));
        task.assignedAgent = ctx.team.lead;
        task.assignedAgentId = ctx.team.lead.id;
      }
    }
  }
}

/** 현재 파일 상태 스냅샷 반환 (pre/post 비교용) */
export function takeFileSnapshot(workspace) {
  if (!workspace?.isLocal) return null;
  return {
    untracked: new Set(workspace.getUntrackedFiles()),
    modified: new Set(workspace.getModifiedFiles()),
  };
}

/**
 * Git 작업을 직렬 큐에 추가하여 순차 실행을 보장
 */
export function enqueueGit(ctx, fn) {
  const wrapped = ctx._gitQueue.then(() => fn());
  ctx._gitQueue = wrapped.catch(() => {});
  return wrapped;
}

/**
 * 수정된 코드를 워크스페이스에 재기록 + 재커밋
 */
export function recommitCode(ctx, task, rawCode, commitMessage, preSnapshot) {
  if (!ctx.workspace?.isLocal) return;

  return enqueueGit(ctx, () => {
    try {
      const EXCLUDE_PATTERNS = [".DS_Store", ".polymeld/"];
      const isExcluded = (f) => EXCLUDE_PATTERNS.some((p) => f.includes(p));

      let filesToAdd = [];
      if (preSnapshot) {
        const postUntracked = ctx.workspace.getUntrackedFiles();
        const postModified = ctx.workspace.getModifiedFiles();
        const newFiles = postUntracked.filter((f) => !preSnapshot.untracked.has(f) && !isExcluded(f));
        const changedFiles = postModified.filter((f) => !preSnapshot.modified.has(f) && !isExcluded(f));
        filesToAdd = [...new Set([...newFiles, ...changedFiles])];
      }

      if (filesToAdd.length > 0) {
        task.filePaths = filesToAdd;
        task.filePath = filesToAdd[0];
        ctx.workspace.gitAdd(filesToAdd);
      } else {
        const paths = task.filePaths || (task.filePath ? [task.filePath] : []);
        if (paths.length === 0) return;
        const codeMatch = rawCode.match(/```[\w]*\n([\s\S]*?)```/);
        const cleanCode = codeMatch ? codeMatch[1] : rawCode;
        ctx.workspace.writeFile(paths[0], cleanCode);
        ctx.workspace.gitAdd(paths);
      }

      ctx.workspace.invalidateCache();
      ctx.workspace.gitCommit(commitMessage);
    } catch (e) {
      console.log(chalk.yellow(`  ${t("pipeline.recommitFailed", { message: e.message })}`));
    }
  });
}

/**
 * 개발자에게 수정을 요청하고 결과를 재커밋
 */
export async function applyDevFix(ctx, task, { feedbackSource, attempt, labels }) {
  const agent = task.assignedAgent;
  const fixSpinner = (await import("ora")).default(
    `  ${t(labels.spinnerStart, { agent: agent?.name, model: agent?.modelKey })}`
  ).start();

  const fixBundle = ctx.assembler.forFix(ctx.state, {
    agentId: task.assignedAgentId,
    taskId: task.id,
    feedbackSource,
  });
  const preSnapshot = takeFileSnapshot(ctx.workspace);
  const fixResult = await agent?.writeCode(fixBundle);

  if (fixResult) {
    task.code = fixResult.code;
    await recommitCode(
      ctx, task, fixResult.code,
      `fix: ${feedbackSource} feedback for ${task.title} (#${task.issueNumber})`,
      preSnapshot
    );
    await ctx.github.addComment(
      task.issueNumber,
      t(labels.commentKey, { agent: agent?.name, model: agent?.modelKey, attempt })
    );
  }

  fixSpinner.succeed(`  ${t(labels.spinnerDone, { agent: agent?.name })}`);
  printMeta(fixResult?.meta);
}
