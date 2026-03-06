#!/usr/bin/env node

// src/index.js
// Agent Team CLI - 멀티 AI 모델 개발팀 시뮬레이션
// PipelineState + PromptAssembler 기반 아키텍처

import "dotenv/config";
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
  .name("agent-team")
  .description(
    "멀티 AI 모델 기반 개발팀 시뮬레이션 - Claude Code, Gemini CLI, Codex CLI 협업"
  )
  .version("0.1.0");

// ─── 메인 커맨드: 전체 파이프라인 실행 ────────────────

program
  .command("run")
  .description("전체 파이프라인 실행 (요구사항 → 미팅 → 개발 → PR)")
  .argument("<requirement>", "프로젝트 요구사항")
  .option("-c, --config <path>", "설정 파일 경로")
  .option(
    "-m, --mode <mode>",
    "인터랙션 모드: full-auto | semi-auto | manual",
    "semi-auto"
  )
  .option(
    "--timeout <seconds>",
    "자동 진행 전 대기 시간 (0=즉시)",
    "0"
  )
  .option("--no-interactive", "full-auto 모드의 단축 옵션")
  .action(async (requirement, options) => {
    const config = loadConfig(options.config);
    await validateConnections(config);

    // 인터랙션 모드 결정
    let interactionMode = options.mode;
    if (options.interactive === false) {
      interactionMode = "full-auto";
    }

    // 타임아웃 설정
    if (options.timeout) {
      config.pipeline = {
        ...config.pipeline,
        auto_timeout: parseInt(options.timeout),
      };
    }

    console.log(chalk.bold.cyan("\n🤖 Agent Team CLI\n"));
    console.log(chalk.gray(`인터랙션 모드: ${interactionMode}`));
    if (interactionMode === "full-auto") {
      console.log(
        chalk.gray(
          "  → 모든 확인을 자동으로 통과합니다 (에러 시에만 멈춤)"
        )
      );
    } else if (interactionMode === "semi-auto") {
      console.log(
        chalk.gray(
          "  → Phase 전환 시에만 확인, 내부 세부사항은 자동 진행"
        )
      );
    } else {
      console.log(
        chalk.gray("  → 모든 확인 포인트에서 사용자 입력을 기다림")
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
  .description("회의만 진행 (킥오프 또는 기술 설계)")
  .argument("<type>", "회의 유형: kickoff | design")
  .argument("<topic>", "회의 주제/요구사항")
  .option("-c, --config <path>", "설정 파일 경로")
  .option("-r, --rounds <n>", "토론 라운드 수", "2")
  .action(async (type, topic, options) => {
    const config = loadConfig(options.config);
    await validateConnections(config);
    const adapter = new ModelAdapter(config);

    const state = new PipelineState();
    state.project.requirement = topic;
    const assembler = new PromptAssembler();

    const team = new Team(config, adapter, { state, assembler });

    console.log(chalk.bold.cyan(`\n🗣️  ${type} 미팅 시작\n`));

    const meetingLog = await team.conductMeeting(topic, "", {
      rounds: parseInt(options.rounds),
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
      const issue = await github.createIssue(
        `${emoji} ${type} 미팅: ${topic.substring(0, 50)}`,
        markdown,
        ["meeting-notes", type, "agent-team"]
      );
      console.log(chalk.green(`\n✅ 회의록 등록: #${issue.number}`));
    }
  });

// ─── 모델 테스트 ────────────────────────────────────────

program
  .command("test-models")
  .description("설정된 모델들의 연결 상태 테스트")
  .option("-c, --config <path>", "설정 파일 경로")
  .action(async (options) => {
    const config = loadConfig(options.config);
    await validateConnections(config);
    const adapter = new ModelAdapter(config);

    console.log(chalk.bold("\n🔌 모델 연결 테스트\n"));

    const available = adapter.getAvailableModels();
    for (const modelKey of Object.keys(config.models)) {
      const isAvailable = available.includes(modelKey);
      const status = isAvailable ? chalk.green("✅ 연결됨") : chalk.red("❌ 미연결");
      console.log(`  ${modelKey}: ${status}`);

      if (isAvailable) {
        try {
          const response = await adapter.chat(
            modelKey,
            "You are a test assistant.",
            "Reply with just 'OK' to confirm connection.",
            { maxTokens: 10 }
          );
          console.log(chalk.gray(`    응답: ${response.trim()}`));
        } catch (e) {
          console.log(chalk.red(`    에러: ${e.message}`));
        }
      }
    }

    // 페르소나별 모델 배정 현황
    console.log(chalk.bold("\n👥 페르소나 모델 배정:\n"));
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
  .description("현재 디렉토리에 설정 파일 생성")
  .action(async () => {
    const { models } = await inquirer.prompt([
      {
        type: "checkbox",
        name: "models",
        message: "사용할 AI 모델을 선택하세요:",
        choices: [
          { name: "Claude Code (Anthropic)", value: "claude", checked: true },
          { name: "Gemini CLI (Google)", value: "gemini" },
          { name: "Codex CLI (OpenAI)", value: "codex" },
        ],
      },
    ]);

    console.log(chalk.green("\n✅ 설정 파일 생성 완료"));
    console.log(chalk.gray("1. CLI 도구를 설치하세요 (claude, gemini, codex)"));
    console.log(chalk.gray("2. agent-team.config.yaml에서 페르소나별 모델을 지정하세요"));
    console.log(chalk.gray('3. agent-team run "요구사항" 으로 시작하세요\n'));
  });

// ─── 인터랙티브 REPL 모드 ────────────────────────────────

program
  .command("start")
  .description("인터랙티브 REPL 모드 시작 (세션 유지, 슬래시 명령어)")
  .option("-c, --config <path>", "설정 파일 경로")
  .option("-r, --resume [sessionId]", "이전 세션 이어하기 (ID 생략 시 최근 세션)")
  .option(
    "-m, --mode <mode>",
    "인터랙션 모드: full-auto | semi-auto | manual",
    "semi-auto"
  )
  .action(async (options) => {
    const config = loadConfig(options.config);
    await validateConnections(config);

    // 인터랙션 모드 설정
    config.pipeline = {
      ...config.pipeline,
      interaction_mode: options.mode,
    };

    const repl = new ReplShell(config);

    if (options.resume) {
      repl.loadSession(options.resume);
    }

    await repl.start();
  });

program.parse();
