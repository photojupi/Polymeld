// src/repl/paste-detect-stream.js
// Bracketed Paste Mode 감지용 Transform 스트림
// process.stdin과 readline 사이에 삽입하여 붙여넣기 마커를 가로챈다.

import { Transform } from "stream";

const PASTE_START = "\x1b[200~"; // 6 bytes
const PASTE_END = "\x1b[201~";   // 6 bytes
const MARKER_MAX_LEN = PASTE_START.length; // 시작/종료 마커 길이 동일

export class PasteDetectStream extends Transform {
  constructor(source) {
    super();
    this._source = source;
    this._pasting = false;
    this._pasteBuffer = "";
    this._partial = ""; // 청크 경계에 걸린 불완전 마커
  }

  // readline이 TTY로 인식하도록 속성 프록시
  get isTTY() { return this._source.isTTY; }
  get columns() { return this._source.columns; }
  get rows() { return this._source.rows; }

  setRawMode(mode) {
    if (this._source.setRawMode) {
      this._source.setRawMode(mode);
    }
    return this;
  }

  _transform(chunk, encoding, callback) {
    let data = this._partial + chunk.toString();
    this._partial = "";
    let output = "";

    while (data.length > 0) {
      if (this._pasting) {
        const endIdx = data.indexOf(PASTE_END);
        if (endIdx === -1) {
          // 종료 마커가 청크 경계에 걸릴 수 있으므로 마지막 바이트 보존
          if (data.length < MARKER_MAX_LEN) {
            this._partial = data;
            data = "";
          } else {
            const safe = data.length - (MARKER_MAX_LEN - 1);
            this._pasteBuffer += data.substring(0, safe);
            this._partial = data.substring(safe);
            data = "";
          }
        } else {
          this._pasteBuffer += data.substring(0, endIdx);
          this._pasting = false;
          this.emit("paste", this._pasteBuffer);
          this._pasteBuffer = "";
          data = data.substring(endIdx + PASTE_END.length);
        }
      } else {
        const startIdx = data.indexOf(PASTE_START);
        if (startIdx === -1) {
          // 시작 마커가 청크 경계에 걸릴 수 있으므로 마지막 바이트 보존
          if (data.length < MARKER_MAX_LEN) {
            this._partial = data;
            data = "";
          } else {
            const safe = data.length - (MARKER_MAX_LEN - 1);
            output += data.substring(0, safe);
            this._partial = data.substring(safe);
            data = "";
          }
        } else {
          if (startIdx > 0) {
            output += data.substring(0, startIdx);
          }
          this._pasting = true;
          this._pasteBuffer = "";
          data = data.substring(startIdx + PASTE_START.length);
        }
      }
    }

    if (output) this.push(output);
    callback();
  }

  _flush(callback) {
    if (this._partial) {
      if (this._pasting) {
        this._pasteBuffer += this._partial;
      } else {
        this.push(this._partial);
      }
      this._partial = "";
    }
    // partial 여부와 무관하게 미완성 붙여넣기 처리
    if (this._pasting && this._pasteBuffer) {
      this.emit("paste", this._pasteBuffer);
      this._pasteBuffer = "";
      this._pasting = false;
    }
    callback();
  }
}
