// src/config/loader.js
// 설정 파일 로더

import fs from "fs";
import path from "path";
import YAML from "yaml";
import { execFileSync, spawn } from "child_process";
import os from "os";
import chalk from "chalk";

export function loadConfig(configPath) {
  // 설정 파일 경로 결정
  const resolvedPath =
    configPath || findConfigFile() || getDefaultConfigPath();

  if (!fs.existsSync(resolvedPath)) {
    console.error(`설정 파일을 찾을 수 없습니다: ${resolvedPath}`);
    console.error("agent-team.config.yaml 파일을 생성해주세요.");
    process.exit(1);
  }

  const raw = fs.readFileSync(resolvedPath, "utf-8");
  const config = YAML.parse(raw);

  return config;
}

function findConfigFile() {
  const candidates = [
    "agent-team.config.yaml",
    "agent-team.config.yml",
    ".agent-team.yaml",
    ".agent-team.yml",
  ];

  for (const name of candidates) {
    const p = path.resolve(process.cwd(), name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getDefaultConfigPath() {
  return path.resolve(process.cwd(), "agent-team.config.yaml");
}

/**
 * CLI 명령어 존재 여부 확인
 */
function isCliInstalled(command) {
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
 * stdout 또는 stderr에 데이터가 오면 즉시 성공 처리
 */
function probeCliAuth(cli) {
  const probes = {
    claude: { args: ["-p", "--output-format", "text", "--max-turns", "1"], stdin: "Reply OK" },
    gemini: { args: ["--output-format", "text"], stdin: "Reply OK" },
    codex: { args: ["exec", "--output-format", "text"], stdin: "echo OK" },
  };
  const probe = probes[cli];
  if (!probe) return Promise.resolve({ ok: false, reason: "unknown" });

  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.CLAUDECODE; // Claude 중첩 세션 방지

    let proc;
    try {
      proc = spawn(cli, probe.args, {
        stdio: ["pipe", "pipe", "pipe"],
        env,
      });
    } catch {
      return resolve({ ok: false, reason: "실행 실패" });
    }

    let resolved = false;
    const done = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { proc.kill("SIGKILL"); } catch {}
      resolve(result);
    };

    const timer = setTimeout(() => done({ ok: false, reason: "응답 시간 초과" }), 30000);

    // stdout 또는 stderr 출력이 있으면 인증 성공 (CLI가 동작 중)
    proc.stdout.on("data", () => done({ ok: true }));
    proc.stderr.on("data", () => done({ ok: true }));
    proc.on("close", (code) => done({ ok: code === 0, reason: code !== 0 ? "인증 실패" : null }));
    proc.on("error", () => done({ ok: false, reason: "실행 실패" }));

    try {
      proc.stdin.write(probe.stdin);
      proc.stdin.end();
    } catch {
      done({ ok: false, reason: "입력 실패" });
    }
  });
}

/**
 * GitHub 토큰 유효성 확인 (GET /user)
 */
async function checkGitHub() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;

  if (!token && !repo) return { ok: false, reason: "GITHUB_TOKEN, GITHUB_REPO 미설정" };
  if (!token) return { ok: false, reason: "GITHUB_TOKEN 미설정" };
  if (!repo) return { ok: false, reason: "GITHUB_REPO 미설정" };

  const headers = { Authorization: `Bearer ${token}`, "User-Agent": "agent-team-cli" };

  try {
    // 1) 토큰 인증 확인
    const userRes = await fetch("https://api.github.com/user", { headers });
    if (!userRes.ok) return { ok: false, reason: "토큰 인증 실패" };
    const userData = await userRes.json();

    // 2) 리포지토리 쓰기 권한 확인
    const repoRes = await fetch(`https://api.github.com/repos/${repo}`, { headers });
    if (!repoRes.ok) return { ok: false, reason: `리포지토리 접근 불가 (${repo})` };

    const repoData = await repoRes.json();
    if (!repoData.permissions?.push) {
      return { ok: false, reason: `리포지토리 쓰기 권한 없음 (${repo})` };
    }

    return { ok: true, user: userData.login, repo };
  } catch {
    return { ok: false, reason: "네트워크 연결 실패" };
  }
}

/**
 * 한 줄을 지우고 다시 쓰기 (터미널 인라인 업데이트)
 */
function rewriteLine(text) {
  process.stdout.write(`\r\x1b[K${text}`);
}

/**
 * CLI 설치 + 인증 + GitHub 연동 상태를 실시간으로 확인·출력
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

  // 각 CLI: 설치 확인 → 인증 확인 → 결과 (순차 출력, 인증은 병렬)
  const pad = 8;
  const authPromises = [];
  const missingClis = [];

  for (const cli of allClis) {
    const label = cli.padEnd(pad);
    const installed = isCliInstalled(cli);

    if (!installed) {
      console.log(chalk.red(`  ❌ ${label} 미설치 → ${installCommands[cli] || ""}`));
      missingClis.push(cli);
      continue;
    }

    // "확인 중" 표시 후, 인증 프로브 시작
    rewriteLine(chalk.gray(`  ⏳ ${label} 인증 확인 중...`));
    authPromises.push(
      probeCliAuth(cli).then((auth) => {
        // 프로브 완료 시점에 즉시 결과 출력 (줄바꿈)
        if (auth.ok) {
          rewriteLine(chalk.green(`  ✅ ${label} 연결됨\n`));
        } else {
          rewriteLine(chalk.yellow(`  ⚠️  ${label} 설치됨 · ${auth.reason || "인증 실패"}\n`));
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
  rewriteLine(chalk.gray(`  ⏳ ${ghLabel} 연동 확인 중...`));
  const github = await checkGitHub();
  if (github.ok) {
    rewriteLine(chalk.green(`  ✅ ${ghLabel} 연동됨 (${github.repo})\n`));
  } else {
    rewriteLine(chalk.red(`  ❌ ${ghLabel} ${github.reason || "미연동"}\n`));
    console.log();
    console.error(chalk.red("GitHub 연동이 필요합니다. 아래 사항을 확인해주세요:"));
    console.error(chalk.gray("  1. .env 파일에 GITHUB_TOKEN, GITHUB_REPO가 올바르게 설정되어 있는지"));
    console.error(chalk.gray("  2. 토큰에 Issues, Contents, Pull requests 쓰기 권한이 있는지"));
    console.error(chalk.gray("  3. 토큰이 해당 리포지토리에 접근 가능한지\n"));
    process.exit(1);
  }
  console.log();

  // 필수 CLI 미설치 시 종료
  if (missingClis.length > 0) {
    const blocked = [];
    for (const [, persona] of Object.entries(config.personas)) {
      const modelConfig = config.models[persona.model];
      if (modelConfig && missingClis.includes(modelConfig.cli)) {
        blocked.push(`   - ${persona.name} (${persona.role}) → ${modelConfig.cli} (미설치)`);
      }
    }
    if (blocked.length > 0) {
      console.error("\n❌ 사용 중인 페르소나에 필요한 CLI가 설치되지 않았습니다:");
      blocked.forEach((line) => console.error(line));
      console.error("\n위 CLI를 먼저 설치한 후 다시 실행해주세요.\n");
      process.exit(1);
    }
  }
}
