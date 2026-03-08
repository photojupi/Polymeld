// test/e2e/_helpers.js
// E2E 테스트 공유 헬퍼 (파일명이 .test.js가 아니므로 테스트로 실행되지 않음)

import crossSpawn from "cross-spawn";
import { ModelAdapter } from "../../src/models/adapter.js";

export { initI18n } from "../../src/i18n/index.js";

/** CLI를 직접 실행하고 stdout을 반환 (타임아웃 60초) */
export function runCli(command, args, stdin, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE; // Claude 중첩 세션 방지

    const proc = crossSpawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`${command} 타임아웃 (${timeoutMs}ms)`));
    }, timeoutMs);

    proc.stdout.on("data", (d) => { stdout += d; });
    proc.stderr.on("data", (d) => { stderr += d; });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`${command} exit ${code}: ${stderr.substring(0, 300)}`));
      else resolve(stdout);
    });
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
    proc.stdin.write(stdin);
    proc.stdin.end();
  });
}

/** _normalizeOutput 호출을 위한 최소 어댑터 */
export function createTestAdapter() {
  return Object.create(ModelAdapter.prototype);
}
