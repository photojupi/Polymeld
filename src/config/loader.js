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

    const timer = setTimeout(() => done({ ok: false, reason: "응답 시간 초과" }), 10000);

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

  try {
    const res = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "agent-team-cli" },
    });
    if (res.ok) {
      const data = await res.json();
      return { ok: true, user: data.login, repo };
    }
    return { ok: false, reason: "토큰 인증 실패" };
  } catch {
    return { ok: false, reason: "네트워크 연결 실패" };
  }
}

/**
 * CLI 설치 + 인증 + GitHub 연동 상태를 확인하고 출력
 */
export async function validateConnections(config) {
  const installCommands = {
    claude: "npm install -g @anthropic-ai/claude-code",
    gemini: "npm install -g @google/gemini-cli",
    codex: "npm install -g @openai/codex",
  };

  // 사용 중인 CLI 수집
  const allClis = new Set();
  for (const modelConfig of Object.values(config.models)) {
    allClis.add(modelConfig.cli);
  }

  // 설치 확인(sync) + 인증 프로브(async) 병렬 시작
  const results = {};
  const promises = [];

  for (const cli of allClis) {
    const installed = isCliInstalled(cli);
    results[cli] = { installed, auth: null };
    if (installed) {
      promises.push(probeCliAuth(cli).then((auth) => { results[cli].auth = auth; }));
    }
  }

  let github = null;
  promises.push(checkGitHub().then((gh) => { github = gh; }));

  await Promise.allSettled(promises);

  // 결과 출력
  const pad = 8;
  for (const cli of allClis) {
    const r = results[cli];
    const label = cli.padEnd(pad);
    if (!r.installed) {
      console.log(chalk.red(`  ❌ ${label} 미설치 → ${installCommands[cli] || ""}`));
    } else if (r.auth?.ok) {
      console.log(chalk.green(`  ✅ ${label} 연결됨`));
    } else {
      console.log(chalk.yellow(`  ⚠️  ${label} 설치됨 · ${r.auth?.reason || "인증 실패"}`));
    }
  }

  if (github?.ok) {
    console.log(chalk.green(`  ✅ ${"GitHub".padEnd(pad)} 연동됨 (${github.repo})`));
  } else {
    console.log(chalk.yellow(`  ⚠️  ${"GitHub".padEnd(pad)} ${github?.reason || "미연동"}`));
  }
  console.log();

  // 필수 CLI 미설치 시 종료
  const missingClis = [...allClis].filter((cli) => !results[cli].installed);
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
