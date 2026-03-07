// src/repl/slash-menu.js
// 슬래시 명령 인라인 피커 — readline을 생성하지 않고 stdin data 이벤트를 직접 처리
// @inquirer/search가 readline을 생성하여 keypress 체인을 오염시키는 문제를 회피

import chalk from "chalk";

/**
 * 문자열의 터미널 표시 폭을 계산한다.
 * CJK 문자(한글, 한자, 일본어 가나 등)는 2칸, 나머지는 1칸.
 */
export function displayWidth(str) {
  let w = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    // CJK Unified Ideographs, Hangul Syllables, Katakana/Hiragana, Fullwidth Forms 등
    if (
      (cp >= 0x1100 && cp <= 0x115F) ||   // Hangul Jamo
      (cp >= 0x2E80 && cp <= 0x303E) ||   // CJK Radicals, Kangxi, CJK Symbols
      (cp >= 0x3041 && cp <= 0x33BF) ||   // Hiragana, Katakana, CJK Compatibility
      (cp >= 0x3400 && cp <= 0x4DBF) ||   // CJK Unified Ideographs Extension A
      (cp >= 0x4E00 && cp <= 0xA4CF) ||   // CJK Unified Ideographs, Yi
      (cp >= 0xAC00 && cp <= 0xD7AF) ||   // Hangul Syllables
      (cp >= 0xF900 && cp <= 0xFAFF) ||   // CJK Compatibility Ideographs
      (cp >= 0xFE30 && cp <= 0xFE6F) ||   // CJK Compatibility Forms
      (cp >= 0xFF01 && cp <= 0xFF60) ||   // Fullwidth Forms
      (cp >= 0xFFE0 && cp <= 0xFFE6) ||   // Fullwidth Signs
      (cp >= 0x20000 && cp <= 0x2FA1F)    // CJK Ext B–F, Compatibility Supplement
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

export class SlashMenu {
  constructor(items) {
    this.items = items;           // [{ name, value }]
    this.filter = "";
    this.selectedIndex = 0;
    this.renderedLines = 0;
    this._resolve = null;
    this._onData = null;
  }

  show() {
    return new Promise((resolve) => {
      this._resolve = resolve;
      this._onData = (buf) => this._handleInput(buf);

      process.stdout.write("\x1b[?25l"); // 커서 숨기기 (깜빡임 방지)
      process.stdin.resume(); // unpipe 후 pause 상태일 수 있으므로 명시적 resume
      process.stdin.on("data", this._onData);
      this._render();
    });
  }

  _handleInput(buf) {
    const str = buf.toString();

    if (str === "\x1b[A") {                                     // ↑
      this._moveSelection(-1);
    } else if (str === "\x1b[B") {                              // ↓
      this._moveSelection(1);
    } else if (str === "\r" || str === "\n") {                  // Enter
      const filtered = this._getFiltered();
      this._finish(filtered[this.selectedIndex]?.value ?? null);
    } else if (str === "\x1b" || str === "\x03") {              // Escape / Ctrl+C
      this._finish(null);
    } else if (str === "\x7f" || str === "\b") {                // Backspace
      if (this.filter.length === 0) {
        this._finish(null);
      } else {
        this.filter = this.filter.slice(0, -1);
        this.selectedIndex = 0;
        this._render();
      }
    } else if (str.charCodeAt(0) >= 32 && !str.startsWith("\x1b")) { // 출력 가능 문자
      this.filter += str;
      this.selectedIndex = 0;
      this._render();
    }
  }

  _moveSelection(delta) {
    const filtered = this._getFiltered();
    if (filtered.length === 0) return;
    this.selectedIndex = Math.max(0, Math.min(filtered.length - 1, this.selectedIndex + delta));
    this._render();
  }

  _getFiltered() {
    if (!this.filter) return this.items;
    const lower = this.filter.toLowerCase();
    return this.items.filter(item =>
      item.value.toLowerCase().includes(lower) ||
      item.name.toLowerCase().includes(lower)
    );
  }

  _render() {
    this._clearRendered();

    const cols = process.stdout.columns || 80;
    const filtered = this._getFiltered();
    const maxRows = Math.min(filtered.length, (process.stdout.rows || 24) - 2);
    const visible = filtered.slice(0, maxRows);
    const lines = [];

    // 검색 프롬프트
    const hint = this.filter ? "" : chalk.gray("type to filter...");
    lines.push(`  / ${this.filter}${hint}`);

    // 메뉴 항목
    for (let i = 0; i < visible.length; i++) {
      const text = visible[i].name.substring(0, cols - 6);
      if (i === this.selectedIndex) {
        lines.push(chalk.cyan(`  ❯ ${text}`));
      } else {
        lines.push(`    ${text}`);
      }
    }

    if (filtered.length === 0) {
      lines.push(chalk.gray("    (no matches)"));
    }

    process.stdout.write(lines.join("\n"));
    this.renderedLines = lines.length;

    // 커서를 프롬프트 줄(첫 번째 줄)의 filter 끝으로 이동
    if (lines.length > 1) {
      process.stdout.write(`\x1b[${lines.length - 1}A`);
    }
    // "  / " = 4칸, 그 뒤에 filter 텍스트 (CJK 문자는 2칸 차지)
    process.stdout.write(`\r\x1b[${4 + displayWidth(this.filter)}G`);
  }

  _clearRendered() {
    if (this.renderedLines === 0) return;

    // 현재 줄 지우기
    process.stdout.write("\x1b[2K");
    // 아래 줄들 지우기
    for (let i = 1; i < this.renderedLines; i++) {
      process.stdout.write("\x1b[B\x1b[2K");
    }
    // 커서를 첫 번째 줄로 복귀
    if (this.renderedLines > 1) {
      process.stdout.write(`\x1b[${this.renderedLines - 1}A`);
    }
    process.stdout.write("\r");
    this.renderedLines = 0;
  }

  _finish(value) {
    process.stdin.removeListener("data", this._onData);
    this._clearRendered();
    process.stdout.write("\x1b[?25h"); // 커서 보이기 복원
    this._resolve(value);
  }
}
