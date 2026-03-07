// src/repl/paste-detect-stream.js
// Bracketed Paste Mode 감지용 Transform 스트림
// process.stdin과 readline 사이에 삽입하여 붙여넣기 마커를 가로챈다.

import { Transform } from "stream";

const PASTE_START = "\x1b[200~"; // 6 chars
const PASTE_END = "\x1b[201~";   // 6 chars

// data 끝부분이 marker의 접두사와 얼마나 겹치는지 반환
// 예: data="hello\x1b[2", marker="\x1b[200~" → 3 ("\x1b[2"가 marker 접두사)
function trailingMarkerPrefixLen(data, marker) {
  const maxCheck = Math.min(data.length, marker.length - 1);
  for (let len = maxCheck; len > 0; len--) {
    if (marker.startsWith(data.substring(data.length - len))) {
      return len;
    }
  }
  return 0;
}

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
          // 끝부분이 PASTE_END 접두사와 겹치는 경우만 홀딩
          const hold = trailingMarkerPrefixLen(data, PASTE_END);
          if (hold > 0) {
            this._pasteBuffer += data.substring(0, data.length - hold);
            this._partial = data.substring(data.length - hold);
          } else {
            this._pasteBuffer += data;
          }
          data = "";
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
          // 끝부분이 PASTE_START 접두사와 겹치는 경우만 홀딩
          const hold = trailingMarkerPrefixLen(data, PASTE_START);
          if (hold > 0) {
            output += data.substring(0, data.length - hold);
            this._partial = data.substring(data.length - hold);
          } else {
            output += data;
          }
          data = "";
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
