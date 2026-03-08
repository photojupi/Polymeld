#!/usr/bin/env node

// src/index.js
// Polymeld - 멀티 AI 모델 개발팀 시뮬레이션
// PipelineState + PromptAssembler 기반 아키텍처

import "dotenv/config";
import { loadCredentials, detectGitHubRepo } from "./config/credentials.js";
import { initI18n, t } from "./i18n/index.js";

loadCredentials();
detectGitHubRepo();
await initI18n();

import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, validateConnections, hasGlobalConfig } from "./config/loader.js";
import { ModelAdapter } from "./models/adapter.js";
import { Team } from "./agents/team.js";
import { GitHubClient, NoOpGitHub } from "./github/client.js";
import { PipelineOrchestrator } from "./pipeline/orchestrator.js";
import { PipelineState } from "./state/pipeline-state.js";
import { PromptAssembler } from "./state/prompt-assembler.js";
import { ReplShell } from "./repl/repl-shell.js";
import { Session } from "./session/session.js";
import { initGlobalConfig, initProjectConfig, runAuthPrompt, runOnboarding } from "./config/init.js";
import { getCredentialStatus } from "./config/credentials.js";

const program = new Command();

program
  .name("polymeld")
  .description(t("cli.description"))
  .version("0.1.0");

// ─── 메인 커맨드: 전체 파이프라인 실행 ────────────────

program
  .command("run")
  .description(t("cli.run.description"))
  .argument("<requirement>", t("cli.run.argRequirement"))
  .option("-c, --config <path>", t("cli.run.optConfig"))
  .option(
    "-m, --mode <mode>",
    t("cli.run.optMode")
  )
  .option(
    "--timeout <seconds>",
    t("cli.run.optTimeout")
  )
  .option("--no-interactive", t("cli.run.optNoInteractive"))
  .action(async (requirement, options) => {
    const config = loadConfig(options.config);
    await validateConnections(config);

    // 인터랙션 모드 결정 (CLI 인자 → config 파일 → 기본값 순)
    let interactionMode = options.mode || config.pipeline?.interaction_mode || "semi-auto";
    if (options.interactive === false) {
      interactionMode = "full-auto";
    }

    // 타임아웃 설정 (CLI 인자가 명시된 경우에만 config 덮어쓰기)
    if (options.timeout != null) {
      config.pipeline = {
        ...config.pipeline,
        auto_timeout: parseInt(options.timeout),
      };
    }

    console.log(chalk.bold.cyan("\n🤖 Polymeld\n"));
    console.log(chalk.gray(t("cli.run.interactionMode", { mode: interactionMode })));
    if (interactionMode === "full-auto") {
      console.log(
        chalk.gray(`  → ${t("cli.run.modeFullAuto")}`)
      );
    } else if (interactionMode === "semi-auto") {
      console.log(
        chalk.gray(`  → ${t("cli.run.modeSemiAuto")}`)
      );
    } else {
      console.log(
        chalk.gray(`  → ${t("cli.run.modeManual")}`)
      );
    }

    // Session 경유로 실행 (workspace 자동 초기화 포함)
    const session = new Session(config);
    try {
      await session.runPipeline(requirement, {
        mode: interactionMode,
      });
    } catch (error) {
      console.error(chalk.red(`\n${error.message}`));
      process.exit(1);
    }
  });

// ─── 회의만 실행 ────────────────────────────────────────

program
  .command("meeting")
  .description(t("cli.meeting.description"))
  .argument("<topic>", t("cli.meeting.argTopic"))
  .option("-c, --config <path>", t("cli.run.optConfig"))
  .option("-r, --rounds <n>", t("cli.run.optTimeout"))
  .action(async (topic, options) => {
    const config = loadConfig(options.config);
    await validateConnections(config);
    const adapter = new ModelAdapter(config);

    const state = new PipelineState();
    state.project.requirement = topic;
    const assembler = new PromptAssembler();

    const team = new Team(config, adapter, { state, assembler });

    console.log(chalk.bold.cyan(`\n${t("cli.meeting.meetingStart")}\n`));

    const meetingLog = await team.conductMeeting(topic, "", {
      rounds: options.rounds ? parseInt(options.rounds) : (config.pipeline?.max_planning_rounds || 2),
      onSpeak: ({ phase, agent, content }) => {
        if (phase === "spoke") {
          console.log(chalk.bold(`\n[${agent}]`));
          console.log(content);
          console.log(chalk.gray("─".repeat(50)));
        }
      },
    });

    const markdown = team.formatMeetingAsMarkdown(meetingLog);

    // GitHub에 등록
    if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPO) {
      const github = new GitHubClient(
        process.env.GITHUB_TOKEN,
        process.env.GITHUB_REPO
      );
      const title = await team.generateTitle(topic);
      const issue = await github.createIssue(
        t("cli.meeting.meetingIssueTitle", { title }),
        markdown,
        ["meeting-notes", "planning", "polymeld"]
      );
      console.log(chalk.green(`\n${t("cli.meeting.meetingRegistered", { number: issue.number, url: github.issueUrl(issue.number) })}`));
    }
  });

// ─── 모델 테스트 ────────────────────────────────────────

program
  .command("test-models")
  .description(t("cli.testModels.description"))
  .option("-c, --config <path>", t("cli.run.optConfig"))
  .action(async (options) => {
    const config = loadConfig(options.config);
    await validateConnections(config);
    const adapter = new ModelAdapter(config);

    console.log(chalk.bold(`\n${t("cli.testModels.header")}\n`));

    const available = adapter.getAvailableModels();
    for (const modelKey of Object.keys(config.models)) {
      const isAvailable = available.includes(modelKey);
      const status = isAvailable ? chalk.green(t("cli.testModels.connected")) : chalk.red(t("cli.testModels.notConnected"));
      console.log(`  ${modelKey}: ${status}`);

      if (isAvailable) {
        try {
          const response = await adapter.chat(
            modelKey,
            "You are a test assistant.",
            "Reply with just 'OK' to confirm connection.",
            { maxTokens: 10 }
          );
          console.log(chalk.gray(`    ${t("cli.testModels.response", { response: response.trim() })}`));
        } catch (e) {
          console.log(chalk.red(`    ${t("cli.testModels.error", { message: e.message })}`));
        }
      }
    }

    // 페르소나별 모델 배정 현황
    console.log(chalk.bold(`\n${t("cli.testModels.personaHeader")}\n`));
    for (const [id, persona] of Object.entries(config.personas)) {
      const modelAvailable = available.includes(persona.model);
      const status = modelAvailable ? "✅" : "❌";
      const imageTag = persona.image_model
        ? chalk.gray(` + image:${persona.image_model}`)
        : "";
      console.log(
        `  ${status} ${t(`agent.personas.${id}.name`, { defaultValue: persona.name })} (${persona.role}) → ${persona.model}${imageTag}`
      );
    }
  });

// ─── 설정 초기화 ────────────────────────────────────────

program
  .command("init")
  .description(t("cli.init.description"))
  .option("--global", t("cli.init.optGlobal"))
  .action(async (options) => {
    if (options.global) {
      await initGlobalConfig();
    } else {
      await initProjectConfig();
    }
  });

// ─── 자격 증명 관리 ────────────────────────────────────────

program
  .command("auth")
  .description(t("cli.auth.description"))
  .option("--show", t("cli.auth.optShow"))
  .action(async (options) => {
    if (options.show) {
      const status = getCredentialStatus();
      console.log(chalk.bold(`\n${t("cli.auth.header")}\n`));
      for (const s of status) {
        const icon = s.set ? chalk.green("✅") : chalk.gray("⬚");
        const val = s.masked || chalk.gray(t("cli.auth.notSet"));
        console.log(`  ${icon} ${s.key}: ${val}`);
      }
      console.log();
      return;
    }

    await runAuthPrompt();
  });

// ─── 인터랙티브 REPL 모드 ────────────────────────────────

program
  .command("start")
  .description(t("cli.start.description"))
  .option("-c, --config <path>", t("cli.run.optConfig"))
  .option("-r, --resume [sessionId]", t("cli.start.optResume"))
  .option(
    "-m, --mode <mode>",
    t("cli.start.optMode")
  )
  .action(async (options) => {
    const config = loadConfig(options.config);
    await validateConnections(config);

    // 인터랙션 모드 설정 (CLI 인자가 명시된 경우에만 config 덮어쓰기)
    if (options.mode) {
      config.pipeline = {
        ...config.pipeline,
        interaction_mode: options.mode,
      };
    }

    const repl = new ReplShell(config);

    if (options.resume) {
      repl.loadSession(options.resume);
    }

    await repl.start();
  });

// 인수 없이 실행 시: 온보딩 또는 REPL 직접 진입
// --lang 플래그와 그 값을 제외한 실제 CLI 인수 확인
const userArgs = process.argv.slice(2).filter((arg, i, arr) => {
  if (arg === "--lang") return false;
  if (i > 0 && arr[i - 1] === "--lang") return false;
  return true;
});

if (userArgs.length === 0) {
  if (!hasGlobalConfig()) {
    const completed = await runOnboarding();
    if (!completed) process.exit(0);
  }

  const config = loadConfig();
  await validateConnections(config);
  const repl = new ReplShell(config);
  await repl.start();
} else {
  program.parse();
}
