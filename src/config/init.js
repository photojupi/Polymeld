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
    },
  ]);

  // config.yaml 생성
  fs.mkdirSync(globalDir, { recursive: true });
  fs.writeFileSync(configPath, generateGlobalTemplate(models), "utf-8");
  console.log(chalk.green(t("cli.init.globalCreated", { path: configPath })));

  // credentials 설정 제안
  const { setupAuth } = await inquirer.prompt([
    { type: "confirm", name: "setupAuth", message: t("cli.init.setupAuth"), default: true },
  ]);

  if (setupAuth) {
    await runAuthPrompt();
  }

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
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "GITHUB_TOKEN",
      message: "GitHub Personal Access Token:",
      default: process.env.GITHUB_TOKEN || "",
    },
    {
      type: "input",
      name: "GITHUB_REPO",
      message: "GitHub Repository (owner/repo):",
      default: process.env.GITHUB_REPO || "",
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
  const modelEntries = [];
  if (models.includes("claude")) {
    modelEntries.push("  claude:\n    cli: claude\n    model: claude-sonnet-4-6");
  }
  if (models.includes("gemini")) {
    modelEntries.push("  gemini:\n    cli: gemini\n    model: gemini-3.1-pro-preview");
  }
  if (models.includes("codex")) {
    modelEntries.push("  codex:\n    cli: codex\n    model: gpt-5.4");
  }

  return `# Polymeld 글로벌 설정
# 이 파일은 모든 프로젝트에 적용되는 기본 설정입니다.
# 프로젝트별 오버라이드: <project>/.polymeld/config.yaml

models:
${modelEntries.join("\n")}

cli:
  timeout: 600000

pipeline:
  interaction_mode: semi-auto
  thinking_budget: 70
`;
}

function generateProjectTemplate() {
  return `# Polymeld 프로젝트 설정
# 이 파일은 팀원과 공유되는 설정입니다 (git commit 대상).
# 개인 설정: .polymeld/config.local.yaml (.gitignore에 추가)

pipeline:
  interaction_mode: semi-auto
  parallel_development: true
  max_review_retries: 3
  max_qa_retries: 3
`;
}
