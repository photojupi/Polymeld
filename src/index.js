#!/usr/bin/env node

// src/index.js
// Polymeld - 멀티 AI 모델 개발팀 시뮬레이션
// PipelineState + PromptAssembler 기반 아키텍처

import "dotenv/config";
import { initI18n, t } from "./i18n/index.js";

await initI18n();

import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import { loadConfig, validateConnections } from "./config/loader.js";
import { ModelAdapter } from "./models/adapter.js";
import { Team } from "./agents/team.js";
import { GitHubClient, NoOpGitHub } from "./github/client.js";
import { PipelineOrchestrator } from "./pipeline/orchestrator.js";
import { PipelineState } from "./state/pipeline-state.js";
import { PromptAssembler } from "./state/prompt-assembler.js";
import { ReplShell } from "./repl/repl-shell.js";
import { Session } from "./session/session.js";

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
  .argument("<type>", t("cli.meeting.argType"))
  .argument("<topic>", t("cli.meeting.argTopic"))
  .option("-c, --config <path>", t("cli.run.optConfig"))
  .option("-r, --rounds <n>", t("cli.run.optTimeout"))
  .action(async (type, topic, options) => {
    const config = loadConfig(options.config);
    await validateConnections(config);
    const adapter = new ModelAdapter(config);

    const state = new PipelineState();
    state.project.requirement = topic;
    const assembler = new PromptAssembler();

    const team = new Team(config, adapter, { state, assembler });

    console.log(chalk.bold.cyan(`\n${t("cli.meeting.meetingStart", { type })}\n`));

    const meetingLog = await team.conductMeeting(topic, "", {
      rounds: options.rounds ? parseInt(options.rounds) : undefined,
      onSpeak: ({ phase, agent, content }) => {
        if (phase === "spoke") {
          console.log(chalk.bold(`\n[${agent}]`));
          console.log(content);
          console.log(chalk.gray("─".repeat(50)));
        }
      },
    });

    const markdown = team.formatMeetingAsMarkdown(meetingLog, type);

    // GitHub에 등록
    if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPO) {
      const github = new GitHubClient(
        process.env.GITHUB_TOKEN,
        process.env.GITHUB_REPO
      );
      const emoji = type === "kickoff" ? "📋" : "🏗️";
      const title = await team.generateTitle(topic);
      const issue = await github.createIssue(
        t("cli.meeting.meetingIssueTitle", { emoji, type, title }),
        markdown,
        ["meeting-notes", type, "polymeld"]
      );
      console.log(chalk.green(`\n${t("cli.meeting.meetingRegistered", { number: issue.number })}`));
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
        `  ${status} ${persona.name} (${persona.role}) → ${persona.model}${imageTag}`
      );
    }
  });

// ─── 설정 초기화 ────────────────────────────────────────

program
  .command("init")
  .description(t("cli.init.description"))
  .action(async () => {
    const { models } = await inquirer.prompt([
      {
        type: "checkbox",
        name: "models",
        message: t("cli.init.selectModels"),
        choices: [
          { name: "Claude Code (Anthropic)", value: "claude", checked: true },
          { name: "Gemini CLI (Google)", value: "gemini" },
          { name: "Codex CLI (OpenAI)", value: "codex" },
        ],
      },
    ]);

    console.log(chalk.green(`\n${t("cli.init.created")}`));
    console.log(chalk.gray(t("cli.init.step1")));
    console.log(chalk.gray(t("cli.init.step2")));
    console.log(chalk.gray(t("cli.init.step3") + "\n"));
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

program.parse();
