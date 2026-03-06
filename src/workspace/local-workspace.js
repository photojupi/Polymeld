// src/workspace/local-workspace.js
// 로컬 Git 레포 워크스페이스 - 파일 읽기/쓰기 + git CLI 래퍼

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage",
  "__pycache__", ".cache", ".turbo", ".nuxt", ".output",
]);

const CODE_EXTENSIONS = new Set([
  ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs",
  ".py", ".go", ".java", ".rb", ".rs", ".c", ".cpp", ".h",
  ".vue", ".svelte", ".css", ".scss", ".html", ".json", ".yaml", ".yml",
]);

export class LocalWorkspace {
  isLocal = true;

  constructor(repoPath) {
    this.repoPath = path.resolve(repoPath);
    this._validateGitRepo();
    this._treeCache = null;
    this._filesCache = null;
  }

  _validateGitRepo() {
    const gitDir = path.join(this.repoPath, ".git");
    if (!fs.existsSync(gitDir)) {
      throw new Error(`Git 레포가 아닙니다: ${this.repoPath}`);
    }
  }

  // ─── 파일 탐색 ──────────────────────────────────────

  /**
   * 코드 파일 목록 반환 (상대 경로)
   */
  listFiles() {
    if (this._filesCache) return this._filesCache;
    const result = [];
    this._walkDir(this.repoPath, result);
    this._filesCache = result.map((f) => path.relative(this.repoPath, f));
    return this._filesCache;
  }

  /** @private */
  _walkDir(dir, result, depth = 0) {
    if (depth > 8) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDE_DIRS.has(entry.name)) continue;
        this._walkDir(full, result, depth + 1);
      } else if (CODE_EXTENSIONS.has(path.extname(entry.name))) {
        result.push(full);
      }
    }
  }

  /**
   * 디렉토리 트리를 문자열로 반환
   */
  getTree(maxDepth = 3) {
    if (this._treeCache) return this._treeCache;
    const lines = [];
    this._buildTree(this.repoPath, "", lines, 0, maxDepth);
    this._treeCache = lines.join("\n");
    return this._treeCache;
  }

  /** @private */
  _buildTree(dir, prefix, lines, depth, maxDepth) {
    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    } catch {
      return;
    }

    const filtered = entries.filter((e) => {
      if (e.name.startsWith(".")) return false;
      if (e.isDirectory() && EXCLUDE_DIRS.has(e.name)) return false;
      return true;
    });

    for (let i = 0; i < filtered.length; i++) {
      const entry = filtered[i];
      const isLast = i === filtered.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const childPrefix = isLast ? "    " : "│   ";

      lines.push(`${prefix}${connector}${entry.name}${entry.isDirectory() ? "/" : ""}`);

      if (entry.isDirectory()) {
        this._buildTree(
          path.join(dir, entry.name),
          prefix + childPrefix,
          lines,
          depth + 1,
          maxDepth,
        );
      }
    }
  }

  // ─── 파일 읽기/쓰기 ────────────────────────────────

  readFile(relativePath) {
    const fullPath = path.join(this.repoPath, relativePath);
    try {
      return fs.readFileSync(fullPath, "utf-8");
    } catch {
      return "";
    }
  }

  /**
   * 키워드 기반 관련 파일 찾기
   * @param {string[]} keywords - 검색 키워드 (task.title, task.category 등)
   * @param {Object} [opts]
   * @param {number} [opts.maxFiles=5]
   * @param {number} [opts.maxCharsPerFile=500]
   * @returns {Array<{path: string, content: string}>}
   */
  findRelevantFiles(keywords, { maxFiles = 5, maxCharsPerFile = 500 } = {}) {
    const files = this.listFiles();
    const normalizedKeywords = keywords
      .filter(Boolean)
      .map((k) => k.toLowerCase().replace(/[^a-z0-9가-힣]/g, ""));

    if (normalizedKeywords.length === 0) return [];

    // 파일 경로 기반 점수 매기기
    const scored = files.map((filePath) => {
      const lower = filePath.toLowerCase();
      let score = 0;
      for (const kw of normalizedKeywords) {
        if (!kw) continue;
        if (lower.includes(kw)) score += 2;
        // 부분 매칭 (3글자 이상)
        if (kw.length >= 3) {
          const parts = lower.split(/[/\\._-]/);
          for (const part of parts) {
            if (part.includes(kw) || kw.includes(part)) score += 1;
          }
        }
      }
      return { path: filePath, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxFiles)
      .map((s) => {
        const content = this.readFile(s.path);
        return {
          path: s.path,
          content: content.length > maxCharsPerFile
            ? content.substring(0, maxCharsPerFile) + "\n...(절삭)"
            : content,
        };
      });
  }

  writeFile(relativePath, content) {
    const fullPath = path.join(this.repoPath, relativePath);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content, "utf-8");
  }

  // ─── Git 명령 ──────────────────────────────────────

  _git(args) {
    return execFileSync("git", args, {
      cwd: this.repoPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  }

  getCurrentBranch() {
    try {
      return this._git(["rev-parse", "--abbrev-ref", "HEAD"]);
    } catch {
      return "main";
    }
  }

  gitCheckoutNewBranch(name, base) {
    try {
      // 이미 해당 브랜치가 있으면 checkout만
      this._git(["checkout", name]);
    } catch {
      // 없으면 새로 생성
      const baseRef = base || this.getCurrentBranch();
      this._git(["checkout", "-b", name, baseRef]);
    }
  }

  gitAdd(files = ["."]) {
    this._git(["add", ...files]);
  }

  gitCommit(message) {
    try {
      this._git(["commit", "-m", message]);
    } catch (e) {
      // nothing to commit인 경우 무시
      if (e.stderr?.includes("nothing to commit")) return;
      throw e;
    }
  }

  gitPush(branch) {
    const currentBranch = branch || this.getCurrentBranch();
    try {
      this._git(["push", "-u", "origin", currentBranch]);
    } catch (e) {
      // remote가 설정되지 않은 경우 등 - 경고만
      console.warn(`  ⚠️ git push 실패: ${e.message || e.stderr}`);
    }
  }

  /**
   * 캐시 무효화 (파일 쓰기 후 tree/files 갱신이 필요할 때)
   */
  invalidateCache() {
    this._treeCache = null;
    this._filesCache = null;
  }
}
