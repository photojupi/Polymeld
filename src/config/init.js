// src/config/init.js
// polymeld init 대화형 설정 초기화

import fs from "fs";
import path from "path";
import chalk from "chalk";
import inquirer from "inquirer";
import { getGlobalConfigDir, getProjectConfigDir } from "./paths.js";
import { saveCredentials } from "./credentials.js";
import { t } from "../i18n/index.js";

/**
 * 글로벌 설정 초기화 (~/.polymeld/)
 */
export async function initGlobalConfig() {
  const globalDir = getGlobalConfigDir();
  const configPath = path.join(globalDir, "config.yaml");

  if (fs.existsSync(configPath)) {
    console.log(chalk.yellow(t("cli.init.globalExists", { path: configPath })));
    return;
  }

  console.log(chalk.bold(`\n${t("cli.init.globalSetupTitle")}\n`));

  // 모델 선택
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
      validate: (v) => v.length > 0 || t("cli.init.selectModelsMin"),
    },
  ]);

  // config.yaml 생성
  fs.mkdirSync(globalDir, { recursive: true });
  fs.writeFileSync(configPath, generateGlobalTemplate(models), "utf-8");
  console.log(chalk.green(t("cli.init.globalCreated", { path: configPath })));

  await runAuthPrompt();

  console.log(chalk.green(`\n${t("cli.init.globalComplete")}`));
  console.log(chalk.gray(`  ${t("cli.init.nextStep")}\n`));
}

/**
 * 프로젝트 설정 초기화 (.polymeld/)
 */
export async function initProjectConfig() {
  const projectDir = getProjectConfigDir();
  const configPath = path.join(projectDir, "config.yaml");

  if (fs.existsSync(configPath)) {
    console.log(chalk.yellow(t("cli.init.projectExists", { path: configPath })));
    return;
  }

  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(configPath, generateProjectTemplate(), "utf-8");

  console.log(chalk.green(t("cli.init.projectCreated", { path: configPath })));
  console.log(chalk.gray(t("cli.init.gitignoreHint")));
}

/**
 * 대화형 자격 증명 입력
 */
export async function runAuthPrompt() {
  // GitHub 토큰 생성 안내
  console.log(chalk.bold(`\n${t("cli.auth.githubGuideTitle")}`));
  console.log(chalk.gray(`  ${t("cli.auth.githubGuideUrl")}`));
  console.log(chalk.gray(`  ${t("cli.auth.githubGuideScopes")}`));
  console.log();

  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "GITHUB_TOKEN",
      message: "GitHub Personal Access Token:",
      default: process.env.GITHUB_TOKEN || "",
      validate: (v) => v.trim() ? true : t("cli.auth.githubTokenRequired"),
    },
    {
      type: "input",
      name: "ANTHROPIC_API_KEY",
      message: `Anthropic API Key (${t("cli.init.optional")}):`,
      default: process.env.ANTHROPIC_API_KEY || "",
    },
    {
      type: "input",
      name: "GOOGLE_API_KEY",
      message: `Google API Key (${t("cli.init.optional")}):`,
      default: process.env.GOOGLE_API_KEY || "",
    },
    {
      type: "input",
      name: "OPENAI_API_KEY",
      message: `OpenAI API Key (${t("cli.init.optional")}):`,
      default: process.env.OPENAI_API_KEY || "",
    },
  ]);

  // 빈 값 제거
  const entries = Object.fromEntries(
    Object.entries(answers).filter(([, v]) => v)
  );

  if (Object.keys(entries).length > 0) {
    const credPath = saveCredentials(entries);
    console.log(chalk.green(t("cli.auth.saved", { path: credPath })));
  }
}

/**
 * 첫 실행 온보딩 위저드
 * initGlobalConfig + 환영 메시지를 묶어 원스톱 설정 경험 제공
 */
export async function runOnboarding() {
  console.log(chalk.bold.cyan(`\n${t("onboarding.welcome")}`));
  console.log(chalk.gray(`  ${t("onboarding.description")}\n`));

  const { proceed } = await inquirer.prompt([
    {
      type: "confirm",
      name: "proceed",
      message: t("onboarding.startSetup"),
      default: true,
    },
  ]);

  if (!proceed) {
    console.log(chalk.gray(`\n  ${t("onboarding.skipped")}\n`));
    return false;
  }

  await initGlobalConfig();

  console.log(chalk.green(`\n${t("onboarding.ready")}\n`));
  return true;
}

function generateGlobalTemplate(models) {
  // 모델 항목 생성 (fallback 포함)
  const fallbackPrefs = {
    claude: ["gemini", "codex"],
    gemini: ["claude", "codex"],
    codex: ["claude", "gemini"],
  };
  const getFallback = (name) => (fallbackPrefs[name] || []).find((p) => models.includes(p));

  const modelEntries = [];
  if (models.includes("claude")) {
    let entry = "  claude:\n    cli: claude\n    model: claude-sonnet-4-6";
    const fb = getFallback("claude");
    if (fb) entry += `\n    fallback: ${fb}`;
    modelEntries.push(entry);
  }
  if (models.includes("gemini")) {
    let entry = "  gemini:\n    cli: gemini\n    model: gemini-3.1-pro-preview";
    const fb = getFallback("gemini");
    if (fb) entry += `\n    fallback: ${fb}`;
    modelEntries.push(entry);
    modelEntries.push("  gemini_image:\n    cli: gemini\n    model: gemini-3.1-flash-image");
  }
  if (models.includes("codex")) {
    let entry = "  codex:\n    cli: codex\n    model: gpt-5.4";
    const fb = getFallback("codex");
    if (fb) entry += `\n    fallback: ${fb}`;
    modelEntries.push(entry);
  }

  // 페르소나별 선호 모델 배정 (없으면 첫 번째 선택 모델로 fallback)
  const fbModel = models[0];
  const pick = (preferred) => models.includes(preferred) ? preferred : fbModel;

  // CLI 타임아웃 (선택된 모델에 맞춰 생성)
  const timeoutLines = [];
  if (models.includes("claude")) timeoutLines.push("    claude: { idle: 600000, max: 1800000 }   # 10min idle, 30min max");
  if (models.includes("gemini")) timeoutLines.push("    gemini: 600000                            # Gemini 10min (wall-clock)");
  if (models.includes("codex")) timeoutLines.push("    codex: { idle: 600000, max: 1800000 }     # 10min idle, 30min max");

  return `# Polymeld Global Settings
# Default settings for all projects.
# Project override: <project>/.polymeld/config.yaml

models:
${modelEntries.join("\n")}

# CLI execution settings
cli:
  timeout: 600000          # Default timeout 10min (ms)
  timeouts:
${timeoutLines.join("\n")}
  max_turns:
    claude: 10             # Claude agentic loop max turns

# Pipeline settings
pipeline:
  # Interaction mode: full-auto | semi-auto | manual
  interaction_mode: full-auto
  # Wait time before auto-proceed on phase transition (seconds). 0 = immediate.
  auto_timeout: 0
  # Auto branch creation
  auto_branch: true
  # Max meeting rounds
  max_planning_rounds: 2
  # AI thinking depth (0-100). Per-persona override available.
  thinking_budget: 70
  # Enable dependency-based parallel execution in Development phase
  parallel_development: true
  # Max code review retry count
  max_review_retries: 3
  # Max QA retry count
  max_qa_retries: 3

# GitHub settings
github:
  labels:
    meeting-notes: "0075ca"
    planning: "d4c5f9"
    backlog: "e4e669"
    todo: "fbca04"
    in-progress: "0e8a16"
    in-review: "1d76db"
    qa: "d93f0b"
    done: "0e8a16"

# Per-persona model assignment
personas:
  # ─── Core Personas ──────────────────────────────────
  tech_lead:
    name: Archie Stone
    role: Tech Lead
    model: ${pick("claude")}
    thinking_budget: 100
    description: |
      Meticulous and strategic. Sees the big picture without missing details.
      Mediates conflicts using data and experience.
    expertise:
      - System architecture design
      - Technical decision-making and trade-off analysis
      - Code review and quality management
      - Project schedule management
    style: |
      "I think we should go with this approach because..."
      "If we consider the trade-offs..."

  ace_programmer:
    name: Cody Sharp
    role: Ace Programmer
    model: ${pick("codex")}
    description: |
      An ace with genius-level coding skills. Elegantly solves complex algorithms and tough problems.
      Pursues both code efficiency and readability — the go-to problem solver when others are stuck.
    expertise:
      - Complex algorithm and data structure implementation
      - Performance optimization and bottleneck resolution
      - System-level programming
      - Legacy code refactoring and tackling hard problems
    style: |
      "This problem can be solved in O(n log n) with this approach"
      "There's a bottleneck here — this change makes it 10x faster"

  creative_programmer:
    name: Nova Cruz
    role: Creative Programmer
    model: ${pick("gemini")}
    description: |
      A creative developer who proposes fresh approaches with unconventional thinking.
      Fast at prototyping, enjoys experimental tech and original solutions.
      Challenges the status quo with 'why?' and implements better UX through code.
    expertise:
      - Prototyping and experimental development
      - Interactive experience implementation
      - Creative algorithms and generative programming
      - New technology exploration and PoC development
    style: |
      "What if we approach this differently?"
      "Instead of the conventional way, how about this? It'll be much more interesting"

  qa:
    name: Tess Hunter
    role: QA Engineer
    model: ${pick("codex")}
    thinking_budget: 70
    description: |
      Naturally suspicious and finds joy in discovering edge cases.
      Values documentation and always demands clarification when acceptance criteria are vague.
    expertise:
      - Test strategy development
      - Edge case discovery
      - Test automation
      - Acceptance criteria definition
    style: |
      "What happens if the user does this?"
      "We need to verify that test coverage is sufficient"

  designer:
    name: Eve Fielding
    role: UX/Visual Designer
    model: ${pick("gemini")}${models.includes("gemini") ? "\n    image_model: gemini_image" : ""}
    description: |
      A design strategist strong in user research and information architecture (IA).
      Analyzes user behavior with data, and creates visual designs and mockups using Nano Banana 2 to visualize ideas.
    expertise:
      - User research and behavior analysis
      - Information architecture (IA) and user flow design
      - Visual design and design systems
      - Mockup creation using AI image generation (Nano Banana 2)
    style: |
      "Looking at user test results, drop-off is high at this flow"
      "Let's establish the information architecture first, then layer the visuals on top"

  ace_planner:
    name: Max Planner
    role: Ace Planner
    model: ${pick("gemini")}
    description: |
      A strategist who sets the project direction. Analyzes requirements sharply and designs user scenarios thoroughly.
      Excels at feature prioritization and scope management.
    expertise:
      - Requirements analysis and feature specification
      - User scenario and use case design
      - Feature prioritization and scope management
      - Project roadmap development
    style: |
      "Starting from the core user scenarios..."
      "The realistic MVP scope for this feature ends here"

  security_expert:
    name: Sam Shield
    role: Security Expert
    model: ${pick("claude")}
    description: |
      A security expert who finds vulnerabilities in every line of code.
      Excels at threat modeling and attack vector analysis. Never allows convenience compromises that sacrifice security.
    expertise:
      - Security vulnerability analysis (OWASP Top 10)
      - Threat modeling and attack vector analysis
      - Authentication/authorization design
      - Secure coding guidelines
    style: |
      "This part is vulnerable to injection attacks"
      "We need to consider this scenario in the auth flow"

  illustrator:
    name: Iris Bloom
    role: Illustrator
    model: ${pick("gemini")}${models.includes("gemini") ? "\n    image_model: gemini_image" : ""}
    description: |
      An illustrator who creates visual assets for the project.
      Generates diverse images including characters, backgrounds, icons, and banners.
      Creates high-quality images using prompt-based generation with Nano Banana 2.
    expertise:
      - Character design and illustration
      - Background and concept art
      - Icon and logo design
      - Asset creation using AI image generation (Nano Banana 2)
    style: |
      "This color palette with this tone would suit the mood"
      "Let's create a character sheet first to maintain consistency"
`;
}

function generateProjectTemplate() {
  return `# Polymeld 프로젝트 설정
# 이 파일은 팀원과 공유되는 설정입니다 (git commit 대상).
# 개인 설정: .polymeld/config.local.yaml (.gitignore에 추가)

pipeline:
  interaction_mode: full-auto
  parallel_development: true
  max_review_retries: 3
  max_qa_retries: 3
`;
}
