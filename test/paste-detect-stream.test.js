import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PasteDetectStream } from "../src/repl/paste-detect-stream.js";
import { PassThrough } from "stream";

function createStream() {
  const source = new PassThrough();
  source.isTTY = true;
  const stream = new PasteDetectStream(source);
  source.pipe(stream);
  return { source, stream };
}

function collectData(stream) {
  const chunks = [];
  stream.on("data", (chunk) => chunks.push(chunk.toString()));
  return chunks;
}

describe("PasteDetectStream", () => {
  it("일반 입력은 그대로 통과", async () => {
    const { source, stream } = createStream();
    const chunks = collectData(stream);

    source.write("hello world");
    source.end();

    await new Promise((resolve) => stream.on("end", resolve));
    assert.equal(chunks.join(""), "hello world");
  });

  it("붙여넣기 마커로 감싸진 내용을 paste 이벤트로 발생", async () => {
    const { source, stream } = createStream();
    stream.resume(); // 데이터 소비

    const pasteContent = await new Promise((resolve) => {
      stream.on("paste", resolve);
      source.write("\x1b[200~line1\nline2\nline3\x1b[201~");
    });

    assert.equal(pasteContent, "line1\nline2\nline3");
  });

  it("붙여넣기 중 데이터는 readline에 전달되지 않음", async () => {
    const { source, stream } = createStream();
    const chunks = collectData(stream);

    let pasteFired = false;
    stream.on("paste", () => { pasteFired = true; });

    source.write("\x1b[200~hidden content\x1b[201~");
    source.end();

    await new Promise((resolve) => stream.on("end", resolve));
    assert.ok(pasteFired);
    assert.equal(chunks.join(""), "");
  });

  it("붙여넣기 전후의 일반 입력도 통과", async () => {
    const { source, stream } = createStream();
    const chunks = collectData(stream);

    let pasteContent = null;
    stream.on("paste", (c) => { pasteContent = c; });

    source.write("before\x1b[200~pasted\x1b[201~after");
    source.end();

    await new Promise((resolve) => stream.on("end", resolve));
    assert.equal(pasteContent, "pasted");
    assert.equal(chunks.join(""), "beforeafter");
  });

  it("마커가 청크 경계에 걸린 경우 처리", async () => {
    const { source, stream } = createStream();
    stream.resume();

    const pasteContent = await new Promise((resolve) => {
      stream.on("paste", resolve);
      // 시작 마커를 두 청크로 분할
      source.write("\x1b[200");
      source.write("~pasted text\x1b[201~");
    });

    assert.equal(pasteContent, "pasted text");
  });

  it("여러 청크에 걸친 붙여넣기 내용 처리", async () => {
    const { source, stream } = createStream();
    stream.resume();

    const pasteContent = await new Promise((resolve) => {
      stream.on("paste", resolve);
      source.write("\x1b[200~chunk1");
      source.write(" chunk2");
      source.write(" chunk3\x1b[201~");
    });

    assert.equal(pasteContent, "chunk1 chunk2 chunk3");
  });

  it("isTTY 속성을 소스에서 프록시", () => {
    const source = new PassThrough();
    source.isTTY = true;
    const stream = new PasteDetectStream(source);
    assert.equal(stream.isTTY, true);
  });

  it("setRawMode를 소스에 위임", () => {
    const source = new PassThrough();
    source.isTTY = true;
    let rawModeSet = false;
    source.setRawMode = (mode) => { rawModeSet = mode; };
    const stream = new PasteDetectStream(source);
    const ret = stream.setRawMode(true);
    assert.equal(rawModeSet, true);
    assert.equal(ret, stream); // 체이닝 가능
  });

  it("일반 문자를 버퍼링하지 않고 즉시 전달 (스마트 버퍼링)", async () => {
    const { source, stream } = createStream();
    const chunks = collectData(stream);

    // 글자별로 입력 (한글 5자 시뮬레이션)
    source.write("안");
    source.write("녕");
    source.write("하");
    source.write("세");
    source.write("요");

    // 즉시 전달되는지 확인 (tick 대기)
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(chunks.join(""), "안녕하세요");
  });

  it("ESC로 끝나는 데이터는 마커 확인을 위해 홀딩", async () => {
    const { source, stream } = createStream();
    const chunks = collectData(stream);

    source.write("hello\x1b");
    await new Promise((resolve) => setImmediate(resolve));

    // "hello"는 통과, "\x1b"는 홀딩 (마커 접두사 가능)
    assert.equal(chunks.join(""), "hello");

    // 마커가 아닌 다른 데이터가 오면 홀딩된 \x1b도 통과
    source.write("X");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(chunks.join(""), "hello\x1bX");
  });

  it("짧은 영문 입력도 즉시 전달", async () => {
    const { source, stream } = createStream();
    const chunks = collectData(stream);

    source.write("a");
    source.write("b");
    source.write("c");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(chunks.join(""), "abc");
  });
});
