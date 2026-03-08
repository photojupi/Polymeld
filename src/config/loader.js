// src/config/loader.js
// 설정 파일 로더

import fs from "fs";
import path from "path";
import YAML from "yaml";
import { execFileSync } from "child_process";
import crossSpawn from "cross-spawn";
import os from "os";
import chalk from "chalk";
import inquirer from "inquirer";
import { t } from "../i18n/index.js";
import { getGlobalConfigDir, getProjectConfigDir } from "./paths.js";
import { isRepoAutoDetected } from "./credentials.js";

/**
 * 글로벌 설정 존재 여부 확인 (온보딩 분기용)
 */
export function hasGlobalConfig() {
  const globalConfig = path.join(getGlobalConfigDir(), "config.yaml");
  return fs.existsSync(globalConfig);
}

/**
 * 설정 로드 (계층적 병합)
 * -c 플래그: 해당 파일만 사용 (하위 호환)
 * 플래그 없음: 글로벌 → 프로젝트 공유 → 프로젝트 로컬 → 레거시 CWD 순서로 병합
 */
export function loadConfig(configPath) {
  // 명시적 경로 지정 시: 기존 동작 유지
  if (configPath) {
    const resolved = path.resolve(configPath);
    if (!fs.existsSync(resolved)) {
      console.error(t("config.configNotFound", { path: resolved }));
      process.exit(1);
    }
    return parseYaml(resolved);
  }

  // 계층적 설정 로드
  const layers = [];

  // 1) 글로벌: ~/.polymeld/config.yaml
  const globalConfig = path.join(getGlobalConfigDir(), "config.yaml");
  if (fs.existsSync(globalConfig)) {
    layers.push(parseYaml(globalConfig));
  }

  // 2) 프로젝트 공유: .polymeld/config.yaml
  const projectConfig = path.join(getProjectConfigDir(), "config.yaml");
  if (fs.existsSync(projectConfig)) {
    layers.push(parseYaml(projectConfig));
  }

  // 3) 프로젝트 로컬: .polymeld/config.local.yaml
  const localConfig = path.join(getProjectConfigDir(), "config.local.yaml");
  if (fs.existsSync(localConfig)) {
    layers.push(parseYaml(localConfig));
  }

  // 4) 레거시 CWD: polymeld.config.yaml 등 (하위 호환)
  const legacyPath = findLegacyConfigFile();
  if (legacyPath) {
    layers.push(parseYaml(legacyPath));
  }

  if (layers.length === 0) {
    // First-run 감지
    console.log(chalk.yellow(`\n${t("config.firstRunMessage")}`));
    console.log(chalk.gray(`  ${t("config.firstRunHint")}\n`));
    process.exit(1);
  }

  return mergeLayers(layers);
}

function parseYaml(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = YAML.parse(raw);
  return parsed && typeof parsed === "object" ? parsed : {};
}

function findLegacyConfigFile() {
  const candidates = [
    "polymeld.config.yaml",
    "polymeld.config.yml",
    ".polymeld.yaml",
    ".polymeld.yml",
  ];

  for (const name of candidates) {
    const p = path.resolve(process.cwd(), name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype;
}

function deepMerge(target, source) {
  const output = { ...target };
  for (const key of Object.keys(source)) {
    if (isPlainObject(source[key]) && isPlainObject(target[key])) {
      output[key] = deepMerge(target[key], source[key]);
    } else {
      output[key] = source[key];
    }
  }
  return output;
}

function mergeLayers(layers) {
  let result = {};
  for (const layer of layers) {
    result = deepMerge(result, layer);
  }
  return result;
}

/**
 * CLI 명령어 존재 여부 확인
 */
export function isCliInstalled(command) {
  try {
    const cmd = os.platform() === "win32" ? "where" : "which";
    execFileSync(cmd, [command], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * CLI 인증 프로브 - 최소한의 프롬프트로 실제 연결 확인
 * stdout 출력 시 즉시 성공, 그 외는 종료 코드로 판정
 */
function probeCliAuth(cli) {
  const probes = {
    claude: { args: ["-p", "--output-format", "text", "--max-turns", "1"], stdin: "Reply OK" },
    gemini: { args: ["--output-format", "text"], stdin: "Reply OK" },
    codex: { args: ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "--full-auto"], stdin: "echo OK" },
  };
  const probe = probes[cli];
  if (!probe) return Promise.resolve({ ok: false, reason: "unknown" });

  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.CLAUDECODE; // Claude 중첩 세션 방지

    let proc;
    try {
      proc = crossSpawn(cli, probe.args, {
        stdio: ["pipe", "pipe", "pipe"],
        env,
      });
    } catch {
      return resolve({ ok: false, reason: t("config.executionFailed") });
    }

    let resolved = false;
    const done = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { proc.kill("SIGKILL"); } catch {}
      resolve(result);
    };

    const timer = setTimeout(() => done({ ok: false, reason: t("config.timeout") }), 30000);

    // stdout 출력이 있으면 인증 성공 (CLI가 실제 응답을 생성 중)
    // stderr는 버퍼링만 — 인증 실패 에러도 stderr로 오므로 성공 판정에 사용하지 않음
    let stderr = "";
    proc.stdout.on("data", () => done({ ok: true }));
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      let reason = null;
      if (code !== 0) {
        const lines = stderr.trim().split("\n").filter((l) => l.trim());
        reason = (lines[lines.length - 1] || "").trim().substring(0, 200) || t("config.authFailed");
      }
      done({ ok: code === 0, reason });
    });
    proc.on("error", () => done({ ok: false, reason: t("config.executionFailed") }));

    try {
      proc.stdin.write(probe.stdin);
      proc.stdin.end();
    } catch {
      done({ ok: false, reason: t("config.inputFailed") });
    }
  });
}

/**
 * GitHub 토큰 유효성 확인
 * - 인증, 리포 접근, 쓰기 권한, Issues/PR 접근까지 점검
 */
async function checkGitHub() {
  const token = process.env.GITHUB_TOKEN;
  let repo = process.env.GITHUB_REPO;

  if (!token) return { ok: false, reason: t("config.tokenMissing") };

  if (!repo) {
    // git remote에서 감지 실패 — 사용자에게 리포 주소 입력 요청
    process.stdout.write("\n");
    console.log(chalk.yellow(`  ${t("config.repoPrompt")}`));
    const { repoInput } = await inquirer.prompt([
      {
        type: "input",
        name: "repoInput",
        message: `GitHub Repository (owner/repo):`,
        validate: (v) => /^[\w.-]+\/[\w.-]+$/.test(v.trim()) || t("config.repoPromptHint"),
      },
    ]);
    const trimmed = repoInput.trim();

    // git 초기화 및 remote 설정
    try {
      if (!fs.existsSync(path.join(process.cwd(), ".git"))) {
        execFileSync("git", ["init"], { cwd: process.cwd(), stdio: "pipe" });
      }
      try {
        execFileSync(
          "git", ["remote", "add", "origin", `https://github.com/${trimmed}.git`],
          { cwd: process.cwd(), stdio: "pipe" }
        );
      } catch {
        // origin이 이미 존재하면 URL만 업데이트
        execFileSync(
          "git", ["remote", "set-url", "origin", `https://github.com/${trimmed}.git`],
          { cwd: process.cwd(), stdio: "pipe" }
        );
      }
    } catch {
      // git 미설치 등 — 무시하고 계속
    }

    process.env.GITHUB_REPO = trimmed;
    repo = trimmed;
  }

  const headers = { Authorization: `Bearer ${token}`, "User-Agent": "polymeld" };

  try {
    // 1) 토큰 인증 확인
    const userRes = await fetch("https://api.github.com/user", { headers });
    if (!userRes.ok) return { ok: false, reason: t("config.tokenAuthFailed") };
    const userData = await userRes.json();

    // 2) 리포지토리 접근 + 쓰기 권한 확인
    const repoRes = await fetch(`https://api.github.com/repos/${repo}`, { headers });
    if (!repoRes.ok) return { ok: false, reason: t("config.repoAccessDenied", { repo }) };

    const repoData = await repoRes.json();
    if (!repoData.permissions?.push) {
      return { ok: false, reason: t("config.repoWriteDenied", { repo }) };
    }

    // 3) 토큰 스코프 확인 (Classic PAT만 — Fine-grained PAT은 이 헤더 없음)
    const warnings = [];
    const scopeHeader = userRes.headers.get("x-oauth-scopes");
    if (scopeHeader != null) {
      // Classic PAT — 스코프 부족 시 경고 (push 체크를 이미 통과했으므로 경고만)
      const scopes = scopeHeader.split(",").map(s => s.trim()).filter(Boolean);
      if (!scopes.includes("repo") && !scopes.includes("public_repo")) {
        warnings.push(t("config.scopeRepoMissing"));
      }
      if (!scopes.includes("project")) {
        warnings.push(t("config.scopeProjectMissing"));
      }
    }

    // 4) Issues 접근 권한 확인 (Fine-grained PAT에서 Contents만 있고 Issues 없는 경우 감지)
    const issuesRes = await fetch(
      `https://api.github.com/repos/${repo}/issues?per_page=1&state=all`,
      { headers }
    );
    if (issuesRes.status === 403) {
      return { ok: false, reason: t("config.issuesAccessDenied", { repo }) };
    }
    if (issuesRes.status === 404) {
      return { ok: false, reason: t("config.issuesDisabled", { repo }) };
    }
    if (!issuesRes.ok) {
      return { ok: false, reason: t("config.issuesAccessDenied", { repo }) };
    }

    // 5) Pull Requests 접근 권한 확인
    const pullsRes = await fetch(
      `https://api.github.com/repos/${repo}/pulls?per_page=1&state=all`,
      { headers }
    );
    if (pullsRes.status === 403) {
      return { ok: false, reason: t("config.pullsAccessDenied", { repo }) };
    }
    if (pullsRes.status === 404) {
      return { ok: false, reason: t("config.pullsDisabled", { repo }) };
    }
    if (!pullsRes.ok) {
      return { ok: false, reason: t("config.pullsAccessDenied", { repo }) };
    }

    // 6) Projects V2 접근 권한 확인 (GraphQL — 경고만)
    try {
      const gqlRes = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "query { viewer { projectsV2(first: 1) { totalCount } } }",
        }),
      });
      const gqlData = await gqlRes.json();
      if (gqlData.errors?.length) {
        warnings.push(t("config.projectsAccessDenied"));
      }
    } catch {
      // 네트워크 오류 시 무시 (필수 체크가 아님)
    }

    return { ok: true, user: userData.login, repo, warnings,
             autoDetected: isRepoAutoDetected() };
  } catch {
    return { ok: false, reason: t("config.networkFailed") };
  }
}

/**
 * 한 줄을 지우고 다시 쓰기 (터미널 인라인 업데이트)
 */
function rewriteLine(text) {
  process.stdout.write(`\r\x1b[K${text}`);
}

/**
 * 해당 CLI 프로바이더에 대응하는 API key가 설정되어 있는지 확인
 */
function hasApiKey(cli) {
  switch (cli) {
    case "claude": return !!process.env.ANTHROPIC_API_KEY;
    case "gemini": return !!process.env.GOOGLE_API_KEY;
    case "codex": return !!process.env.OPENAI_API_KEY;
    default: return false;
  }
}

/**
 * CLI 설치 + 인증 + API key + GitHub 연동 상태를 실시간으로 확인·출력
 *
 * CLI 미설치 + API key 있음 → 경고 후 진행 (API 모드)
 * CLI 미설치 + API key 없음 → 차단
 */
export async function validateConnections(config) {
  const installCommands = {
    claude: "npm install -g @anthropic-ai/claude-code",
    gemini: "npm install -g @google/gemini-cli",
    codex: "npm install -g @openai/codex",
  };

  // 사용 중인 CLI 수집
  const allClis = [...new Set(
    Object.values(config.models).map((m) => m.cli)
  )];

  // 각 CLI: 설치 확인 → 인증 확인 → API key 확인 → 결과
  const pad = 8;
  const authPromises = [];
  const missingClis = [];

  for (const cli of allClis) {
    const label = cli.padEnd(pad);
    const installed = isCliInstalled(cli);
    const apiKeyAvailable = hasApiKey(cli);

    if (!installed) {
      if (apiKeyAvailable) {
        // CLI 미설치 + API key 있음 → 경고 (API 모드로 사용 가능)
        console.log(chalk.yellow(`  ${t("config.notInstalledApiMode", { label })}`));
      } else {
        // CLI 미설치 + API key 없음 → 에러
        console.log(chalk.red(`  ${t("config.notInstalled", { label, command: installCommands[cli] || "" })}`));
      }
      missingClis.push(cli);
      continue;
    }

    // "확인 중" 표시 후, 인증 프로브 시작
    rewriteLine(chalk.gray(`  ${t("config.authChecking", { label })}`));
    authPromises.push(
      probeCliAuth(cli).then((auth) => {
        // 프로브 완료 시점에 즉시 결과 출력 (줄바꿈)
        const apiSuffix = apiKeyAvailable ? ` · ${t("config.apiKeySet")}` : "";
        if (auth.ok) {
          rewriteLine(chalk.green(`  ${t("config.connected", { label })}${apiSuffix}\n`));
        } else {
          rewriteLine(chalk.yellow(`  ${t("config.installedButAuthFailed", { label, reason: auth.reason || t("config.authFailed") })}${apiSuffix}\n`));
        }
        return auth;
      })
    );
    // 다음 CLI 확인 중 표시 전에 현재 줄 줄바꿈 대기
    // (병렬 프로브지만, "확인 중" 텍스트는 순서대로 보여주기 위해 await)
    await authPromises[authPromises.length - 1];
  }

  // GitHub 확인 (CLI 완료 후 시작)
  const ghLabel = "GitHub".padEnd(pad);
  rewriteLine(chalk.gray(`  ${t("config.authChecking", { label: ghLabel })}`));
  const github = await checkGitHub();
  if (github.ok) {
    const autoSuffix = github.autoDetected ? ` · ${t("config.repoAutoDetected")}` : "";
    rewriteLine(chalk.green(`  ${t("config.githubConnected", { label: ghLabel, repo: github.repo })}${autoSuffix}\n`));
    if (github.warnings?.length) {
      for (const w of github.warnings) {
        console.log(chalk.yellow(`  ⚠️  ${ghLabel} ${w}`));
      }
    }
  } else {
    rewriteLine(chalk.red(`  ${t("config.githubFailed", { label: ghLabel, reason: github.reason || "" })}\n`));
    console.log();
    console.error(chalk.red(t("config.githubRequired")));
    console.error(chalk.gray(`  ${t("config.githubStep1")}`));
    console.error(chalk.gray(`  ${t("config.githubStep2")}`));
    console.error(chalk.gray(`  ${t("config.githubStep3")}`));
    console.error(chalk.gray(`  ${t("config.githubStep4")}\n`));
    process.exit(1);
  }
  console.log();

  // 필수 백엔드 누락 시 종료 (CLI 미설치 + API key 없음)
  if (missingClis.length > 0) {
    const blocked = [];
    const apiOnly = [];

    for (const [id, persona] of Object.entries(config.personas || {})) {
      const modelConfig = (config.models || {})[persona.model];
      const name = t(`agent.personas.${id}.name`, { defaultValue: persona.name });
      if (modelConfig && missingClis.includes(modelConfig.cli)) {
        if (hasApiKey(modelConfig.cli)) {
          apiOnly.push(`   - ${name} (${persona.role}) → ${t("config.apiModeLabel")}`);
        } else {
          blocked.push(`   - ${name} (${persona.role}) → ${modelConfig.cli} (${t("config.installRequired", { cli: modelConfig.cli })})`);
        }
      }
    }

    if (apiOnly.length > 0) {
      console.log(chalk.yellow(`  ${t("config.apiModeNotice")}`));
      apiOnly.forEach((line) => console.log(chalk.yellow(line)));
      console.log();
    }

    if (blocked.length > 0) {
      console.error(`\n${t("config.missingBackend")}`);
      blocked.forEach((line) => console.error(line));
      console.error(`\n${t("config.installOrApiKey")}\n`);
      process.exit(1);
    }
  }
}
