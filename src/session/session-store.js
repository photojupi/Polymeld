// src/session/session-store.js
// 세션 데이터를 디스크에 저장/복원

import fs from "fs";
import path from "path";

const SESSIONS_DIR = ".agent-team/sessions";

export class SessionStore {
  constructor(baseDir = process.cwd()) {
    this.dir = path.join(baseDir, SESSIONS_DIR);
  }

  _ensureDir() {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  _sanitizeId(id) {
    const sanitized = String(id).replace(/[^a-zA-Z0-9_-]/g, "");
    if (!sanitized) throw new Error("Invalid session ID");
    return sanitized;
  }

  /**
   * 세션 데이터를 JSON 파일로 저장
   * @param {string} id - 세션 ID
   * @param {Object} data - 직렬화된 세션 데이터
   * @returns {string} 저장된 파일 경로
   */
  save(id, data) {
    id = this._sanitizeId(id);
    this._ensureDir();
    const filePath = path.join(this.dir, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    return filePath;
  }

  /**
   * 세션 데이터를 파일에서 복원
   * @param {string} id - 세션 ID
   * @returns {Object|null}
   */
  load(id) {
    id = this._sanitizeId(id);
    const filePath = path.join(this.dir, `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * 저장된 세션 목록 반환
   * @returns {Array<{id: string, updatedAt: string, file: string}>}
   */
  list() {
    this._ensureDir();
    const files = fs.readdirSync(this.dir).filter(f => f.endsWith(".json"));
    return files.map(f => {
      const id = f.replace(".json", "");
      const filePath = path.join(this.dir, f);
      const stat = fs.statSync(filePath);
      return { id, updatedAt: stat.mtime.toISOString(), file: f };
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * 세션 파일 삭제
   * @param {string} id
   */
  delete(id) {
    id = this._sanitizeId(id);
    const filePath = path.join(this.dir, `${id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}
